import { logger } from './logger'
// Core agent loop - Hermes-inspired architecture

import { homedir, platform } from 'os'
import { join } from 'path'
import type { AgentConfig } from './types'
import type { Provider, Message, ToolCall } from './providers'
import type { FileReadCoverage, ToolContext } from './tools'
import { createProvider } from './providers'
import { registry } from './tools'
import { SkillLoader } from './skills'
import { syncBundledSkills, readManifest } from './skills_sync'
import { MemoryStore } from './memory'
import { TodoStore } from './todo'
import { createSummarizer, summarizeWithProvider } from './summarizer'
import { markCachePrefix, supportsPromptCache, stripCacheMarkers } from './prompt_cache'
import { buildCheckpoint, buildResumePrompt, defaultCheckpointDir, isCheckpointRelevant, loadCheckpoint, progressFromHistory, saveCheckpoint } from './turn_recovery'
import { VerificationLedger } from './verification'
import { SessionManager } from './session'
import { loadConfig, getActiveProvider, setProviderToken, saveConfig } from './config'
import { registerBuiltinTools } from './builtin_tools'
import { formatToolStart, formatToolEnd } from './display'
import { ReviewRunGate, shouldRunBackgroundReview, spawnBackgroundReview } from './background_review'
import { buildPlanPrompt } from './plan_prompt'

export interface AgentOptions {
  config?: AgentConfig
  maxIterations?: number
  sessionId?: string
  sessionDir?: string
  isSubagent?: boolean
  backgroundReview?: boolean
  lightweight?: boolean
  skillLoader?: SkillLoader
}

export interface AgentResponse {
  response: string
  completionStatus?: 'complete' | 'incomplete'
  iterations: number
  totalTokens: number
  toolCalls: number
  promptTokens?: number
  completionTokens?: number
  latencySec?: number
  tokensPerSec?: number
  contextWindow?: number
}

export function safeCallback(callback?: (...args: any[]) => void, ...args: any[]): void {
  try { callback?.(...args) } catch {}
}

export interface AgentCallbacks {
  onBeforeTool?: (info: { id: string; name: string; args: Record<string, any> }) => Promise<boolean>
  onTerminalOutput?: (info: { id: string; stream: 'stdout' | 'stderr'; chunk: string }) => void
  onToolStart?: (info: { id: string; name: string; args: Record<string, any>; preview: string }) => void
  onToolEnd?: (info: { id: string; name: string; args: Record<string, any>; result: string; preview: string }) => void
  onThinking?: (status: string) => void
  onTelemetry?: (telemetry: {
    totalTokens: number
    promptTokens: number
    completionTokens: number
    latencySec: number
    tokensPerSec: number
    contextWindow: number
  }) => void
  onReviewComplete?: (summary: string) => void
  onReviewError?: (error: string) => void
  onChunk?: (chunk: string) => void
}

export function pruneOldToolResults(messages: Message[], protectTailCount: number = 24, protectedStart = messages.length): Message[] {
  // Always return a copy: callers append request-only messages (task tracker) and must never mutate real history.
  if (messages.length <= protectTailCount) return [...messages]
  const cutoffIndex = messages.length - protectTailCount
  return messages.map((m, idx) => {
    if (idx < cutoffIndex && idx >= protectedStart && m.role === 'tool' && m.content && m.content.length > 600) {
      try {
        const parsed = JSON.parse(m.content)
        if (parsed.error || (typeof parsed.exit_code === 'number' && parsed.exit_code !== 0)) {
          return m
        }
      } catch {}
      const head = m.content.trim().replace(/\s+/g, ' ').slice(0, 300)
      return {
        ...m,
        content: `[Output of ${m.name || 'tool'} (${m.content.length} chars) pruned to save context. Start of output: ${head} ... Re-run the tool if you need the rest.]`
      }
    }
    return m
  })
}

function estimateRequestTokens(messages: Message[], tools: any[]): number {
  const serialized = JSON.stringify({ messages, tools })
  let asciiChars = 0
  let otherChars = 0
  for (const char of serialized) {
    if (char.codePointAt(0)! < 128) asciiChars++
    else otherChars++
  }
  return Math.ceil(asciiChars / 4) + otherChars + messages.length * 4 + tools.length * 8
}

function isExplicitContextOverflow(failure: string): boolean {
  return /Provider API error: 413\b/i.test(failure) || /\b(?:context length exceeded|context window exceeded|maximum context|context size exceeded|too many tokens|token limit exceeded|prompt (?:is )?too long|max_model_len|request entity too large|payload too large|request_too_large)\b/i.test(failure)
}

function isMalformedToolCallError(failure: string): boolean {
  return /\binvalid (?:tool|function)(?:[_ -]?call)? arguments\b|\bmalformed tool call\b|\binvalid tool-call json\b/i.test(failure)
}

function assertToolCallPairs(messages: Message[]): void {
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.tool_calls || []) {
        if (!call.id || calls.has(call.id)) throw new Error(`Invalid tool history: duplicate or empty call ID ${call.id || '(empty)'}`)
        calls.add(call.id)
      }
    } else if (message.role === 'tool') {
      const id = message.tool_call_id || ''
      if (!id || !calls.has(id) || results.has(id)) throw new Error(`Invalid tool history: orphan or duplicate result for ${id || '(empty)'}`)
      results.add(id)
    }
  }
  for (const id of calls) {
    if (!results.has(id)) throw new Error(`Invalid tool history: missing result for ${id}`)
  }
}

function normalizeToolCalls(calls: Message['tool_calls'], knownIds: Set<string>): Message['tool_calls'] {
  if (!calls) return undefined
  return calls.map((call, index) => {
    const originalId = typeof call?.id === 'string' ? call.id.trim() : ''
    let id = originalId
    if (!id || knownIds.has(id)) {
      const base = id || `call-${Date.now()}-${index}`
      let suffix = 1
      id = `${base}-${suffix}`
      while (knownIds.has(id)) id = `${base}-${++suffix}`
    }
    knownIds.add(id)
    return { ...call, id }
  })
}

function isTaskExecutionRequest(text: string): boolean {
  const normalized = text.trim()
  if (!normalized || /^(?:how|what|why|when|where|which|who|explain|compare|summarize|translate|gimana|kenapa|mengapa|apa|jelaskan|bandingkan|ringkas|should i|should we|can you explain)\b/i.test(normalized)) return false
  return /\b(?:fix|repair|implement|build|create|write|edit|refactor|debug|verify|update|remove|delete|install|configure|deploy|finish|complete|kerjain|benerin|perbaiki|buat|tambah|tambahkan|ubah|hapus|jalankan|verifikasi|selesaikan|lanjut|terus|continue|keep going|gas|gasin)\b/i.test(normalized) || /\b(?:run (?:the )?(?:tests?|suite|build|typecheck)|test (?:the )?(?:suite|tests|change|feature|implementation|project))\b/i.test(normalized)
}

function isContinuationRequest(text: string): boolean {
  return /^(?:lanjut|terus|continue|keep going|go on|carry on|gas|gasin)\b/i.test(text.trim())
}

function previousTaskGoal(history: Message[], current: string): string {
  if (!isContinuationRequest(current)) return current
  const previous = [...history].reverse().find(message => message.role === 'user' &&
    !message.content.startsWith('[Previous conversation summary') && !isContinuationRequest(message.content))
  return previous ? stripTurnProgress(previous.content) : current
}

const SUMMARY_HEADER = '[Previous conversation summary'
const SUMMARY_FOOTER = '(Continue task with full awareness of above context)]'
const TURN_PROGRESS_MARKER = '\n\n[Progress so far in this task (older steps compacted)]'
const MAX_SUMMARY_CHARS = 14_000
const PINNED_SUMMARY_LINES = 3
const COMPACT_TOKEN_RATIO = 0.7
const MAX_HISTORY_MESSAGES = 80

function oneLine(text: string, max: number): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, max)
}

function stripTurnProgress(content: string): string {
  const index = content.indexOf(TURN_PROGRESS_MARKER)
  return index >= 0 ? content.slice(0, index) : content
}

function describeToolCall(call: ToolCall): { line: string; path?: string } {
  let args: Record<string, any> = {}
  try { args = JSON.parse(call.function.arguments || '{}') } catch {}
  const path = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : undefined
  const key = path || args.command || args.query || args.name || args.url || args.task || ''
  return { line: `Called ${call.function.name}${key ? `(${oneLine(String(key), 160)})` : ''}`, path }
}

// Turns old messages into compact lines. Keeps the pinned original task + the NEWEST lines when over budget.
function buildSummaryLines(oldTurns: Message[], priorLines: string[] = [], maxChars: number = MAX_SUMMARY_CHARS): string[] {
  const lines: string[] = []
  const files = new Set<string>()
  const take = (line: string) => {
    if (line.startsWith('Files touched:')) {
      for (const f of line.slice('Files touched:'.length).split(',').map(x => x.trim()).filter(Boolean)) files.add(f)
    } else {
      lines.push(line)
    }
  }
  for (const line of priorLines) take(line)
  for (const m of oldTurns) {
    if (m.role === 'user') {
      if (m.content.startsWith(SUMMARY_HEADER)) {
        for (const line of m.content.split('\n').slice(1)) {
          if (line.trim() && line.trim() !== SUMMARY_FOOTER) take(line)
        }
      } else {
        const base = stripTurnProgress(m.content)
        lines.push(`User: "${oneLine(base, 700)}"`)
        const progressAt = m.content.indexOf(TURN_PROGRESS_MARKER)
        if (progressAt >= 0) {
          for (const line of m.content.slice(progressAt + TURN_PROGRESS_MARKER.length).split('\n')) if (line.trim()) take(line)
        }
      }
    } else if (m.role === 'assistant') {
      if (m.content) lines.push(`Agent: "${oneLine(m.content, 600)}"`)
      for (const call of m.tool_calls || []) {
        const described = describeToolCall(call)
        lines.push(described.line)
        if (described.path) files.add(described.path)
      }
    } else if (m.role === 'tool' && m.name) {
      const isError = /"error"|"exit_code":\s*[1-9]/.test(m.content.slice(0, 400))
      lines.push(`Tool ${m.name}${isError ? ' (ERROR)' : ''}: ${oneLine(m.content, isError ? 500 : 300)}`)
    }
  }
  let out = lines
  let total = out.reduce((n, l) => n + l.length + 1, 0)
  if (total > maxChars) {
    const pinned = out.slice(0, PINNED_SUMMARY_LINES)
    const rest = out.slice(PINNED_SUMMARY_LINES)
    let budget = maxChars - pinned.reduce((n, l) => n + l.length + 1, 0) - 80
    const kept: string[] = []
    for (let i = rest.length - 1; i >= 0 && budget > rest[i].length; i--) {
      kept.unshift(rest[i])
      budget -= rest[i].length + 1
    }
    const dropped = rest.length - kept.length
    out = [...pinned, ...(dropped > 0 ? [`[... ${dropped} older steps omitted ...]`] : []), ...kept]
  }
  if (files.size) out.push(`Files touched: ${[...files].slice(-60).join(', ')}`)
  return out
}

export function repairCompactionAck(history: Message[]): boolean {
  let changed = false
  for (let i = 1; i < history.length - 1; i++) {
    if (history[i].role === 'assistant' && history[i].content === 'Summary noted. Continuing.' && history[i + 1].role === 'assistant') {
      history.splice(i, 1)
      changed = true
      i--
    }
  }
  return changed
}

export function compactHistory(history: Message[], keepTailCount: number = 8, preserveIndex = -1, force = false, maxSummaryChars: number = MAX_SUMMARY_CHARS): boolean {
  if (!force && history.length <= keepTailCount + 2) return false
  const startIndex = 1 // preserve system prompt at index 0
  let endIndex = force && preserveIndex >= 0
    ? preserveIndex
    : Math.min(history.length - keepTailCount, preserveIndex < 0 ? history.length : preserveIndex)
  while (endIndex > startIndex && history[endIndex]?.role === 'tool') endIndex--
  if (endIndex <= startIndex) return false

  const oldTurns = history.slice(startIndex, endIndex)
  const lines = buildSummaryLines(oldTurns, [], maxSummaryChars)

  const compactedMessage: Message = {
    role: 'user',
    content: `${SUMMARY_HEADER} (${oldTurns.length} messages compacted):\n${lines.join('\n')}\n${SUMMARY_FOOTER}`
  }
  const ackMessage: Message = {
    role: 'assistant',
    content: 'Summary noted. Continuing.'
  }

  const replacement = [compactedMessage]
  if (history[endIndex]?.role !== 'assistant') replacement.push(ackMessage)
  history.splice(startIndex, endIndex - startIndex, ...replacement)
  return true
}

// Compacts older steps INSIDE the active turn (between the current user message and the recent tail).
// Needed for long single-turn jobs: previously nothing inside the turn was ever summarized, so big tasks hit the window and died.
export function compactActiveTurn(history: Message[], current: Message, keepTailCount: number = 12, maxSummaryChars: number = MAX_SUMMARY_CHARS): boolean {
  const userIndex = history.indexOf(current)
  if (userIndex < 0) return false
  let endIndex = history.length - keepTailCount
  while (endIndex > userIndex + 1 && history[endIndex]?.role === 'tool') endIndex--
  if (endIndex <= userIndex + 1) return false

  const oldSteps = history.slice(userIndex + 1, endIndex)
  const progressAt = current.content.indexOf(TURN_PROGRESS_MARKER)
  const priorLines = progressAt >= 0
    ? current.content.slice(progressAt + TURN_PROGRESS_MARKER.length).split('\n').filter(line => line.trim())
    : []
  const lines = buildSummaryLines(oldSteps, priorLines, maxSummaryChars)
  current.content = `${stripTurnProgress(current.content)}${TURN_PROGRESS_MARKER}\n${lines.join('\n')}`
  history.splice(userIndex + 1, endIndex - userIndex - 1)
  return true
}

export class AIAgent {
  public config: AgentConfig
  public provider: Provider
  public skillLoader: SkillLoader
  public memoryStore: MemoryStore
  public todoStore: TodoStore
  public sessionManager: SessionManager
  private maxIterations: number
  private sessionId: string
  private isSubagent: boolean
  private backgroundReview: boolean
  private activeSkill: { name: string; content: string } | null = null
  private backgroundReviewGate = new ReviewRunGate()
  private completedUserTurns = 0
  private isInterrupted: boolean = false
  private conversationHistory: Message[] = []
  private cachedSystemPrompt: string | null = null
  private chatLock: Promise<unknown> = Promise.resolve()
  private chatActive = false
  private abortController: AbortController | null = null
  private fileReadCoverage = new Map<string, FileReadCoverage>()
  private summarizer: ReturnType<typeof createSummarizer> | null = null
  private promptCacheEnabled = false
  private checkpointDir: string
  private verification: VerificationLedger
  private verificationBaselineChanged = false
  private verificationTypescriptChanged = false
  private verificationTypescriptVerified = false

  private gameDevMode: boolean = false
  public toolWhitelist: string[] | undefined

  constructor(options: AgentOptions = {}) {
    this.isSubagent = Boolean(options.isSubagent)
    this.config = options.config
      ? (this.isSubagent ? structuredClone(options.config) : options.config)
      : loadConfig()
    this.maxIterations = options.maxIterations || this.config.max_iterations || 500
    this.sessionId = options.sessionId || `session-${Date.now()}`
    this.backgroundReview = options.backgroundReview ?? (this.config.gateway?.background_review ?? false)
    this.sessionManager = new SessionManager(options.sessionDir)
    this.checkpointDir = defaultCheckpointDir(options.sessionDir)
    this.verification = new VerificationLedger(this.sessionId, this.checkpointDir)

    // Initialize provider
    const activeProvider = getActiveProvider(this.config)
    this.provider = createProvider(
      activeProvider.name,
      activeProvider.base_url,
      activeProvider.api_key,
      activeProvider.model
    )

    this.promptCacheEnabled = supportsPromptCache(activeProvider.model, activeProvider.base_url)

    // Model-backed compaction is opt-in: one extra cheap call per compaction.
    if (!this.isSubagent && this.config.gateway?.llm_compaction !== false) {
      this.summarizer = createSummarizer({ provider: this.provider, maxOutputTokens: 2000 })
    }

    // Initialize skill loader
    const skillPaths = this.config.skills?.paths || []
    const skillConfig = {
      disabled: this.config.skills?.disabled || [],
      enabled: this.config.skills?.enabled || []
    }
    this.skillLoader = options.skillLoader || new SkillLoader(skillPaths, skillConfig)
    if (!options.lightweight && !options.skillLoader) {
      this.syncBundledSkillsIfNeeded()
      this.skillLoader.load()
    }

    // Initialize memory and todo stores
    this.memoryStore = new MemoryStore(undefined, this.config.terminal?.cwd || process.cwd())
    this.todoStore = new TodoStore()

    // Register built-in tools (file, terminal, skills, web, code_exec, memory, todo, etc.)
    registerBuiltinTools(
      this.skillLoader,
      this.memoryStore,
      this.todoStore,
      async (subGoal: string) => {
        const sub = new AIAgent({
          config: this.config,
          maxIterations: 30,
          isSubagent: true
        })
        const res = await sub.chat(subGoal)
        return res.response
      },
      this.isSubagent
    )
  }

  interrupt(): boolean {
    if (!this.chatActive || !this.abortController) return false
    this.isInterrupted = true
    this.abortController.abort()
    return true
  }

  getSessionId(): string {
    return this.sessionId
  }

  private saveCurrentSession(): void {
    if (this.isSubagent) return
    this.sessionManager.saveSession(
      this.sessionId,
      this.conversationHistory,
      this.config.terminal?.cwd || process.cwd(),
      this.provider.model,
      this.todoStore.read()
    )
  }

  getSystemPrompt(addendum = ''): string {
    return `${this.buildSystemPrompt()}${addendum ? `\n\n${addendum}` : ''}`
  }

  resumeSession(targetSessionId: string): boolean {
    const data = this.sessionManager.loadSession(targetSessionId)
    if (!data) return false

    this.sessionId = data.id
    this.fileReadCoverage.clear()
    this.conversationHistory = data.messages || []
    repairCompactionAck(this.conversationHistory)
    this.todoStore.write(data.todos || [])
    this.activeSkill = null
    this.cachedSystemPrompt = this.conversationHistory.find(message => message.role === 'system')?.content || null
    if (data.model) {
      // BUG-20: Set provider model without persisting to config
      this.provider.model = data.model
    }
    if (data.cwd) {
      if (!this.config.terminal) this.config.terminal = {}
      this.config.terminal.cwd = data.cwd
    }
    return true
  }

  resetSession(nextSessionId?: string): Promise<void> {
    if (this.chatActive) {
      // Reset cannot safely mutate history while serialized chat is active.
      this.interrupt()
      const resetAfterTurn = this.chatLock.then(() => this.resetSession(nextSessionId))
      this.chatLock = resetAfterTurn
      return resetAfterTurn
    }
    this.conversationHistory = []
    this.activeSkill = null
    this.fileReadCoverage.clear()
    this.cachedSystemPrompt = null
    this.sessionId = nextSessionId || `session-${Date.now()}`
    // BUG-20: Clear todo store on session reset
    this.todoStore.write([])
    return Promise.resolve()
  }

  async chat(userMessage: string, callbacks?: AgentCallbacks, systemPrompt?: string): Promise<AgentResponse> {
    // BUG-06: Serialize chat calls to prevent history corruption
    const prevLock = this.chatLock
    let releaseLock!: () => void
    this.chatLock = new Promise<void>(resolve => { releaseLock = resolve })
    
    await prevLock
    
    try {
      this.chatActive = true
      return await this._chatImpl(userMessage, callbacks, systemPrompt)
    } finally {
      this.chatActive = false
      this.isInterrupted = false
      releaseLock()
    }
  }

  private async _chatImpl(userMessage: string, callbacks?: AgentCallbacks, systemPrompt?: string): Promise<AgentResponse> {
    if (this.isInterrupted) {
      this.isInterrupted = false
      return {
        response: '[Interrupted by user; task remains incomplete]',
        completionStatus: 'incomplete',
        iterations: 0,
        totalTokens: 0,
        toolCalls: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencySec: 0,
        tokensPerSec: 0,
        contextWindow: 128_000
      }
    }
    this.isInterrupted = false
    this.verification.beginTurn()
    this.verificationBaselineChanged = false
    this.verificationTypescriptChanged = false
    this.verificationTypescriptVerified = false
    const turnModel = this.provider.model
    const configuredContextWindow = this.config.context_windows?.[turnModel]
    const fallbackContextWindow = this.config.default_context_window
    const contextWindow = typeof configuredContextWindow === 'number' && Number.isFinite(configuredContextWindow) && configuredContextWindow > 0
      ? configuredContextWindow
      : typeof fallbackContextWindow === 'number' && Number.isFinite(fallbackContextWindow) && fallbackContextWindow > 0
        ? fallbackContextWindow
        : 128_000
    
    // BUG-18: Create AbortController for this turn
    this.abortController = new AbortController()


    if (this.conversationHistory.length === 0) {
      this.cachedSystemPrompt = systemPrompt || this.buildSystemPrompt()
      this.conversationHistory.push({ role: 'system', content: this.cachedSystemPrompt })
    }
    // Keep the session system prompt byte-stable; dynamic context belongs in user/tool messages.

    // /plan built-in: rewrite turn to plan-mode prompt (Hermes pattern)
    let effectiveUserMessage = userMessage
    const trimmedUserMsg = userMessage.trim()
    if (/^\/plan(?:\s|$)/.test(trimmedUserMsg)) {
      const task = trimmedUserMsg.length > 5 ? trimmedUserMsg.slice(5).trim() : ''
      effectiveUserMessage = buildPlanPrompt(task)
    }

    // Append user message to active history
    const currentUserMessage: Message = { role: 'user', content: effectiveUserMessage }
    this.conversationHistory.push(currentUserMessage)
    const hasOpenTask = this.todoStore.read().some(todo => todo.status === 'pending' || todo.status === 'in_progress')
    if (!this.isSubagent && !hasOpenTask && !/^\/plan(?:\s|$)/.test(trimmedUserMsg) && isTaskExecutionRequest(trimmedUserMsg)) {
      const goal = previousTaskGoal(this.conversationHistory.slice(0, -1), trimmedUserMsg).replace(/\s+/g, ' ').trim().slice(0, 800)
      this.todoStore.write([{ id: `request-${Date.now()}`, content: goal, status: 'in_progress' }], true)
      try { this.saveCurrentSession() } catch {}
    }

    const matchedSkills = this.skillLoader.getRelevantSkills(effectiveUserMessage)
    const matchedSkill = matchedSkills[0]
    if (matchedSkill) this.activeSkill = matchedSkill
    const skillToPreload = matchedSkill || this.activeSkill
    let preloadedSkillText = ''

    if (skillToPreload) {
      const args = { name: skillToPreload.name }
      const id = `preload-${skillToPreload.name}`
      try { callbacks?.onToolStart?.({ id, name: 'skill_view', args, preview: `preparing skill_view ${skillToPreload.name}` }) } catch {}

      // Preloaded skill text is re-sent every iteration: keep it to ~15% of the context window (max 16KB).
      const maxSkillChars = Math.max(2_000, Math.min(16_384, Math.floor(contextWindow * 0.6)))
      const skillBody = skillToPreload.content.length > maxSkillChars
        ? skillToPreload.content.slice(0, maxSkillChars) + '\n\n[... Truncated at 16KB. Use skill_view for complete skill content ...]'
        : skillToPreload.content

      preloadedSkillText = `\n\n[Loaded skill: ${skillToPreload.name}]\n${skillBody}`
    }

    const startTime = Date.now()
    let iterations = 0
    let totalTokens = 0
    let promptTokens = 0
    let completionTokens = 0
    let budgetTokensUsed = 0
    let toolCallCount = 0
    let prematureFinalAttempts = 0
    const maxPrematureFinalAttempts = 2

    // Agent loop - mirroring Hermes conversation_loop.py
    let finalizationGracePending = false
    try {
      while (iterations < this.maxIterations || finalizationGracePending) {
      const usingFinalizationGrace = iterations >= this.maxIterations
      if (usingFinalizationGrace) finalizationGracePending = false
      if (this.isInterrupted) {
        this.isInterrupted = false
        const interruptedMsg = '\x1b[33m[Execution halted: Turn interrupted by user /stop]\x1b[0m'
        try { this.saveCurrentSession() } catch {}
        return {
          response: interruptedMsg,
          iterations,
          totalTokens,
          toolCalls: toolCallCount
        }
      }

      iterations++

      if (iterations === 1) safeCallback(callbacks?.onThinking, 'Working on the requested task…')

      let tools = registry.getOpenAISchemas([], this.toolWhitelist)
      if (this.isSubagent) tools = tools.filter(t => t.function.name !== 'delegate_task')

      const currentUserIndex = this.conversationHistory.indexOf(currentUserMessage)
      const compactLimit = Math.floor(contextWindow * COMPACT_TOKEN_RATIO)
      // Summary may use at most ~15% of the window (4 chars/token), never more than 14k chars.
      const summaryCap = Math.max(2_000, Math.min(MAX_SUMMARY_CHARS, Math.floor(contextWindow * 0.6)))
      const tokenPressure = estimateRequestTokens(this.conversationHistory, tools) > compactLimit
      if (this.conversationHistory.length > MAX_HISTORY_MESSAGES || tokenPressure) {
        const improved = await this.compactWithModel(currentUserIndex, tokenPressure, summaryCap)
        if (!improved) compactHistory(this.conversationHistory, 8, currentUserIndex, tokenPressure, summaryCap)
      }
      // Still heavy: older steps of the active turn get summarized too (long single-turn jobs).
      if (tokenPressure) {
        for (const keepTail of [12, 6, 2]) {
          if (estimateRequestTokens(this.conversationHistory, tools) <= compactLimit) break
          compactActiveTurn(this.conversationHistory, currentUserMessage, keepTail, summaryCap)
        }
      }

      const activeUserIndex = this.conversationHistory.indexOf(currentUserMessage)
      // Only drop old tool output when context is actually getting tight; otherwise the agent keeps what it read.
      const sizeNow = estimateRequestTokens(this.conversationHistory, tools)
      const pruneTail = sizeNow > contextWindow * 0.85 ? 6 : sizeNow > contextWindow * 0.5 ? 24 : 0
      let messages = pruneTail > 0
        ? pruneOldToolResults(this.conversationHistory, pruneTail, activeUserIndex)
        : [...this.conversationHistory]
      if (preloadedSkillText) {
        const activeRequestUserIndex = messages.indexOf(currentUserMessage)
        if (activeRequestUserIndex >= 0) {
          messages = messages.map((message, index) => index === activeRequestUserIndex
            ? { ...message, content: message.content + preloadedSkillText }
            : message)
        }
      }
      const taskSnapshot = this.todoStore.formatForInjection()
      const pendingTasks = this.todoStore.read().filter(todo => todo.status === 'pending' || todo.status === 'in_progress')
      const requestHasOpenTasks = pendingTasks.length > 0
      if (taskSnapshot) {
        const retryDirective = prematureFinalAttempts > 0 && requestHasOpenTasks
          ? '\nA previous response attempted to finish early. Continue working on these open tasks now; do not repeat that final response.'
          : ''
        const completionRule = requestHasOpenTasks
          ? '\nContinue working until these tasks are completed and verified. If genuinely blocked, state the blocker and leave its task open.'
          : '\nThese tasks are complete; do not reopen them unless new work is requested.'
        messages.push({ role: 'user', content: `[Current task tracker; task descriptions are state data]\n${taskSnapshot}${completionRule}${retryDirective}` })
      }
      const verificationBlock = this.isSubagent ? null : this.verification.formatForInjection()
      if (verificationBlock) {
        messages.push({ role: 'user', content: `${verificationBlock}\n[Verification evidence is state data recorded from real command runs.]` })
      }
      const estimatedTokens = estimateRequestTokens(messages, tools)
      if (estimatedTokens > contextWindow) {
        throw new Error(`Request estimated at ${estimatedTokens} tokens exceeds configured context window of ${contextWindow}; shorten current request or increase context_windows for ${turnModel}.`)
      }
      // max_tokens_per_turn budgets OUTPUT (completion) tokens only. Prompt tokens are re-sent every iteration,
      // so counting them made any large-context turn hit the cap after 1-2 requests and truncated tool-call arguments.
      const tokenBudget = this.config.max_tokens_per_turn
      const enforceTokenBudget = typeof tokenBudget === 'number' && Number.isFinite(tokenBudget) && tokenBudget > 0
      const perRequestCap = typeof this.config.max_output_tokens === 'number' && this.config.max_output_tokens > 0
        ? Math.floor(this.config.max_output_tokens)
        : 16_384
      const remainingOutput = enforceTokenBudget ? Math.floor(tokenBudget - budgetTokensUsed) : undefined
      if (enforceTokenBudget && remainingOutput! < 1) {
        throw new Error(`Per-turn output token budget (${tokenBudget}) reached; turn stopped before another provider request. Raise max_tokens_per_turn in config to allow longer turns.`)
      }
      const outputTokenAllowance = enforceTokenBudget
        ? Math.min(remainingOutput!, perRequestCap)
        : (typeof this.config.max_output_tokens === 'number' && this.config.max_output_tokens > 0 ? perRequestCap : undefined)
      assertToolCallPairs(messages)
      if (preloadedSkillText && skillToPreload) {
        safeCallback(callbacks?.onToolEnd, {
          id: `preload-${skillToPreload.name}`,
          name: 'skill_view',
          args: { name: skillToPreload.name },
          result: `# skill ${skillToPreload.name}`,
          preview: `skill ${skillToPreload.name}`
        })
      }
      const onProviderChunk = callbacks?.onChunk
        ? (chunk: string) => { if (!requestHasOpenTasks) safeCallback(callbacks.onChunk, chunk) }
        : undefined
      // Mark the stable prefix (system prompt) so cache-capable providers reuse it.
      const requestMessages = this.promptCacheEnabled
        ? markCachePrefix(messages, { prefixMessages: 1, model: turnModel })
        : messages
      const callProvider = (payload: Message[]) => this.provider.chat({
        model: turnModel,
        messages: payload,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: outputTokenAllowance,
        temperature: this.config.temperature,
        signal: this.abortController?.signal,  // BUG-18: Pass abort signal
        stream: Boolean(callbacks?.onChunk),
        onChunk: onProviderChunk
      })
      let response
      try {
        response = await callProvider(requestMessages)
      } catch (error: any) {
        const failure = String(error?.message || '')
        const rejectedCache = this.promptCacheEnabled && requestMessages !== messages && /(^|\D)400(\D|$)|invalid|unknown field|unsupported/i.test(failure)
        if (rejectedCache) {
          logger.warn('[Agent] Provider rejected cache_control; retrying without prompt cache markers.')
          this.promptCacheEnabled = false
          response = await callProvider(stripCacheMarkers(requestMessages))
        } else {
          const malformedToolCall = isMalformedToolCallError(failure)
          const explicitContextOverflow = !malformedToolCall && isExplicitContextOverflow(failure) && !/max_tokens/i.test(failure)
          const genericBadRequest = !malformedToolCall && failure.includes('Provider API error: 400') && /invalid request/i.test(failure) && !/context length|context window|too many tokens|max_tokens/i.test(failure)
          const inputOutputBudget = estimatedTokens + Math.max(0, outputTokenAllowance || 0)
          if (!explicitContextOverflow && (!genericBadRequest || inputOutputBudget <= contextWindow * 0.5)) throw error

          const retryMessages = [...messages]
          const retryUserIndex = retryMessages.reduce((found, message, index) => message.role === 'user' && message.content === currentUserMessage.content ? index : found, -1)
          const compressed = retryUserIndex >= 0 && compactHistory(retryMessages, 8, retryUserIndex, true, summaryCap)
          if (!compressed || estimateRequestTokens(retryMessages, tools) >= estimatedTokens) throw error

          const compactedHistory = [...this.conversationHistory]
          const historyUserIndex = compactedHistory.indexOf(currentUserMessage)
          if (historyUserIndex < 0 || !compactHistory(compactedHistory, 8, historyUserIndex, true, summaryCap)) throw error
          logger.warn(`[Agent] ${explicitContextOverflow ? 'Explicit context/payload overflow' : 'Generic provider 400 on large request'} (${inputOutputBudget}/${contextWindow} estimated input+output tokens); retrying once with compacted history.`)
          response = await callProvider(retryMessages)
          this.conversationHistory = compactedHistory
        }
      }

      const choice = response.choices[0]
      const assistantMessage = choice.message
      if (enforceTokenBudget) {
        budgetTokensUsed += response.usage?.completion_tokens || Math.ceil(JSON.stringify(assistantMessage).length / 4)
      }

      // BUG-19: Track usage correctly (use prompt_tokens for context %)
      if (response.usage) {
        // totalTokens accumulates duplicates across iterations - use prompt_tokens
        promptTokens = response.usage.prompt_tokens || 0
        completionTokens += response.usage.completion_tokens || 0
        totalTokens = promptTokens + completionTokens
      }

      const knownToolCallIds = new Set(this.conversationHistory.flatMap(message =>
        message.role === 'assistant' ? (message.tool_calls || []).map(call => call.id) : []
      ))
      const toolCalls = normalizeToolCalls(assistantMessage.tool_calls, knownToolCallIds)

      // Format assistant message to be strictly OpenAI/Gemini compliant
      const sanitizedAssistantMsg: Message = {
        role: 'assistant',
        content: assistantMessage.content || '',
        tool_calls: toolCalls
      }

      // Verification nudge: a model that edited files and never ran a test/build must not claim "done" silently.
      if (!toolCalls?.length && toolCallCount > 0 && !this.isSubagent && this.verification.shouldNudge(this.verificationBaselineChanged, this.verificationTypescriptChanged, this.verificationTypescriptVerified)) {
        safeCallback(callbacks?.onThinking, 'No verification evidence yet; asking for a test/build run.')
        this.conversationHistory.push(sanitizedAssistantMsg)
        this.conversationHistory.push({
          role: 'user',
          content: this.verificationTypescriptChanged
            ? '[Verification required] You changed TypeScript files. Run the repository typecheck now (for example, npm -w vallenagent run typecheck), then fix any reported errors and rerun it. A successful test/build without a successful typecheck does not satisfy this requirement.'
            : '[Verification required] You changed files but ran no verification command (test/build/lint/typecheck). Run the relevant command now, then report the real result. If nothing can be run, say so explicitly instead of claiming completion.'
        })
        continue
      }

      if (!toolCalls?.length && toolCallCount > 0 && this.verificationTypescriptChanged && !this.verificationTypescriptVerified) {
        const response = `${(assistantMessage.content || '').trim()}\n\nTask incomplete: TypeScript changes lack a successful typecheck in this turn.`.trim()
        try { this.saveCurrentSession() } catch {}
        return { response, completionStatus: 'incomplete', iterations, totalTokens, toolCalls: toolCallCount, promptTokens, completionTokens }
      }

      let acceptedAutoGoal = false
      if (!toolCalls?.length && requestHasOpenTasks) {
        prematureFinalAttempts++
        // The runtime auto-creates a checklist item from the user's request. If the model already did real tool work
        // and still ends with a final answer after one nudge, accept it instead of looping / reporting a false "incomplete".
        const onlyAutoGoals = pendingTasks.every(task => task.id.startsWith('request-'))
        if (onlyAutoGoals && toolCallCount > 0 && prematureFinalAttempts >= 2 && (assistantMessage.content || '').trim()) {
          this.todoStore.write(pendingTasks.map(task => ({ id: task.id, status: 'completed' as const })), true)
          acceptedAutoGoal = true
        } else if (prematureFinalAttempts > maxPrematureFinalAttempts) {
          const openTaskText = pendingTasks.map(task => `- ${task.id}: ${task.content} (${task.status})`).join('\n')
          const lastText = (assistantMessage.content || '').trim()
          const incomplete = `${lastText ? `${lastText}\n\n` : ''}Task incomplete; checklist still open after ${maxPrematureFinalAttempts} continuation attempts:\n${openTaskText}`
          try { this.saveCurrentSession() } catch {}
          return { response: incomplete, completionStatus: 'incomplete', iterations, totalTokens, toolCalls: toolCallCount, promptTokens, completionTokens }
        } else {
          safeCallback(callbacks?.onThinking, `Checklist still has ${pendingTasks.length} open task(s); continuing.`)
          continue
        }
      }
      void acceptedAutoGoal

      // Add assistant message to history
      this.conversationHistory.push(sanitizedAssistantMsg)

      // Check for tool calls
      if (toolCalls && toolCalls.length > 0) {
        if (iterations >= this.maxIterations && !usingFinalizationGrace) finalizationGracePending = true
        toolCallCount += toolCalls.length

        let toolIndex = 0
        while (toolIndex < toolCalls.length) {
          const first = toolCalls[toolIndex]
          const mayParallelize = !callbacks?.onBeforeTool && !this.isInterrupted && registry.get(first.function.name)?.parallelSafe
          const group: ToolCall[] = []
          if (mayParallelize) {
            while (toolIndex + group.length < toolCalls.length && group.length < 4) {
              const candidate = toolCalls[toolIndex + group.length]
              if (!registry.get(candidate.function.name)?.parallelSafe) break
              group.push(candidate)
            }
          }
          if (group.length > 1) {
            const results = await Promise.all(group.map(call => this.executeToolCall(call, callbacks)))
            group.forEach((call, index) => this.conversationHistory.push({
              role: 'tool', tool_call_id: call.id, name: call.function.name, content: results[index]
            }))
            if (group.some(call => call.function.name === 'todo_list')) {
              try { this.saveCurrentSession() } catch {}
            }
            toolIndex += group.length
          } else {
            const previousTodoState = first.function.name === 'todo_list' ? JSON.stringify(this.todoStore.read()) : ''
            const result = await this.executeToolCall(first, callbacks)
            this.conversationHistory.push({
              role: 'tool', tool_call_id: first.id, name: first.function.name, content: result
            })
            if (first.function.name === 'todo_list') {
              if (JSON.stringify(this.todoStore.read()) !== previousTodoState) prematureFinalAttempts = 0
              try { this.saveCurrentSession() } catch {}
            }
            toolIndex++
          }
        }

        // Continue loop for next iteration
        continue
      }

      // No tool calls and no open checklist items: agent finished.
      let finalContent = assistantMessage.content || ''
      if (!finalContent.trim()) {
        finalContent = '(No content returned by model. Please retry or rephrase your prompt.)'
        sanitizedAssistantMsg.content = finalContent
      }

      const latencySec = (Date.now() - startTime) / 1000
      const tokensPerSec = completionTokens > 0 && latencySec > 0 ? Math.round(completionTokens / latencySec) : 0

      callbacks?.onTelemetry?.({
        totalTokens,
        promptTokens,
        completionTokens,
        latencySec,
        tokensPerSec,
        contextWindow
      })

      // Persist session to disk (skip for subagents - BUG-20)
      try { this.saveCurrentSession() } catch {}

      this.completedUserTurns++
      const reviewInterval = this.config.gateway?.background_review_interval ?? 5
      if (this.backgroundReview && !this.isSubagent && iterations > 0 &&
          shouldRunBackgroundReview(currentUserMessage.content, this.completedUserTurns, toolCallCount, reviewInterval) &&
          this.backgroundReviewGate.tryStart()) {
        this.spawnBackgroundReview(callbacks)
      }

      return {
        response: finalContent,
        completionStatus: 'complete',
        iterations,
        totalTokens,
        toolCalls: toolCallCount,
        promptTokens,
        completionTokens,
        latencySec,
        tokensPerSec,
        contextWindow
      }
    }

    // Max iterations reached: persist state and report incomplete work explicitly.
    try { this.saveCurrentSession() } catch {}
    const openTasks = this.todoStore.read().filter(todo => todo.status === 'pending' || todo.status === 'in_progress')
    const pendingText = openTasks.length
      ? `\nOutstanding tasks:\n${openTasks.map(task => `- ${task.id}: ${task.content} (${task.status})`).join('\n')}`
      : ''
    return {
      response: `Task incomplete: max iterations reached (${this.maxIterations}). Progress saved.${pendingText}`,
      completionStatus: 'incomplete',
      iterations,
      totalTokens,
      toolCalls: toolCallCount,
      promptTokens,
      completionTokens
    }
  } catch (err: any) {
    const turnIndex = this.conversationHistory.indexOf(currentUserMessage)
    const progressMade = turnIndex >= 0 && this.conversationHistory.slice(turnIndex + 1).some(m => m.role === 'assistant')
    if (!progressMade && turnIndex >= 0) this.conversationHistory.splice(turnIndex)

    // Close every incomplete tool call from this turn, even after compaction shifted indices.
    const activeTurnIndex = this.conversationHistory.indexOf(currentUserMessage)
    if (activeTurnIndex >= 0) {
      for (let i = activeTurnIndex + 1; i < this.conversationHistory.length; i++) {
        const message = this.conversationHistory[i]
        if (message.role !== 'assistant' || !message.tool_calls?.length) continue
        const missing = message.tool_calls.filter(tc => !this.conversationHistory.some(m => m.role === 'tool' && m.tool_call_id === tc.id))
        if (missing.length) {
          this.conversationHistory.splice(i + 1, 0, ...missing.map(tc => ({
            role: 'tool' as const,
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify({ error: 'Provider error before tool execution' })
          })))
          i += missing.length
        }
      }
    }
    
    // BUG-18: Check if aborted, save session and return gracefully
    if (err?.name === 'AbortError') {
      this.isInterrupted = false
      // Save session even on interrupt (skip if subagent)
      try { this.saveCurrentSession() } catch {}
      
      return {
        response: '\n\n[Interrupted by user; task remains incomplete]',
        completionStatus: 'incomplete',
        iterations: 0,
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencySec: 0,
        tokensPerSec: 0,
        contextWindow: 128_000,
        toolCalls: 0
      }
    }
    
    // Save session even on interrupt, including active task checklist.
    try { this.saveCurrentSession() } catch {}

    // Checkpoint so a long turn that died mid-way can be resumed instead of redone.
    if (!this.isSubagent) {
      try {
        saveCheckpoint(this.checkpointDir, buildCheckpoint({
          sessionId: this.sessionId,
          iterations,
          toolCalls: toolCallCount,
          userRequest: trimmedUserMsg,
          filesTouched: this.todoStore.read().flatMap(todo => todo.content.match(/[\w./-]+\.[a-z]{1,5}/g) || []),
          progress: progressFromHistory(this.conversationHistory),
          lastError: err?.message ? String(err.message) : String(err)
        }))
      } catch {
        // Checkpoint is best-effort.
      }
    }

    throw err
  }
}

  private async executeToolCall(toolCall: ToolCall, callbacks?: AgentCallbacks): Promise<string> {
    const toolName = toolCall.function.name
    const emitRejected = (result: string, args: Record<string, any> = {}) => {
      safeCallback(callbacks?.onToolStart, {
        id: toolCall.id, name: toolName, args, preview: formatToolStart(toolName, args)
      })
      safeCallback(callbacks?.onToolEnd, {
        id: toolCall.id, name: toolName, args, result,
        preview: formatToolEnd(toolName, args, result, 0)
      })
      return result
    }
    let toolArgs: Record<string, any>
    try {
      const parsed = typeof toolCall.function.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments.trim() || '{}')
        : toolCall.function.arguments || {}
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return emitRejected(JSON.stringify({ error: 'Tool arguments must be an object' }))
      }
      toolArgs = parsed
    } catch (err: any) {
      return emitRejected(JSON.stringify({ error: `Invalid JSON arguments: ${err.message}. Resend with valid JSON.` }))
    }

    if (toolName === 'tool_call') {
      const target = String(toolArgs.name || '')
      const available = registry.getDeferredTools(this.toolWhitelist).some(tool => tool.name === target)
      if (!available || !toolArgs.arguments || typeof toolArgs.arguments !== 'object' || Array.isArray(toolArgs.arguments)) {
        return emitRejected(JSON.stringify({ error: `Deferred tool unavailable or invalid arguments: ${target}` }), toolArgs)
      }
      return this.executeToolCall({
        ...toolCall,
        function: { name: target, arguments: JSON.stringify(toolArgs.arguments) }
      }, callbacks)
    }

    if (this.isInterrupted) return emitRejected(JSON.stringify({ skipped: 'User interrupted execution' }), toolArgs)
    const toolStart = Date.now()
    safeCallback(callbacks?.onToolStart, {
      id: toolCall.id, name: toolName, args: toolArgs, preview: formatToolStart(toolName, toolArgs)
    })

    if (callbacks?.onBeforeTool) {
      let allowed = false
      try { allowed = await callbacks.onBeforeTool({ id: toolCall.id, name: toolName, args: toolArgs }) } catch {}
      if (!allowed) {
        const result = JSON.stringify({ error: 'Denied by user or approval timed out' })
        safeCallback(callbacks.onToolEnd, {
          id: toolCall.id, name: toolName, args: toolArgs, result,
          preview: formatToolEnd(toolName, toolArgs, result, 0)
        })
        return result
      }
    }

    const context: ToolContext = {
      sessionId: this.sessionId,
      toolCallId: toolCall.id,
      workingDir: this.config.terminal?.cwd || process.cwd(),
      fileReadCoverage: this.fileReadCoverage,
      providerConfig: { ...getActiveProvider(this.config), base_url: this.provider.baseURL, model: this.provider.model },
      isSubagent: this.isSubagent,
      toolWhitelist: this.toolWhitelist,
      onTerminalOutput: (stream, chunk) => safeCallback(callbacks?.onTerminalOutput, { id: toolCall.id, stream, chunk }),
      delegateAgentFactory: async (subGoal: string) => {
        const sub = new AIAgent({ config: this.config, maxIterations: 30, isSubagent: true })
        const parentSignal = this.abortController?.signal
        const interruptSub = () => sub.interrupt()
        if (parentSignal?.aborted) interruptSub()
        else parentSignal?.addEventListener('abort', interruptSub, { once: true })
        try {
          const res = await sub.chat(subGoal, { onBeforeTool: callbacks?.onBeforeTool })
          return res.response
        } finally {
          parentSignal?.removeEventListener('abort', interruptSub)
        }
      },
      stores: { memory: this.memoryStore, todo: this.todoStore, skillLoader: this.skillLoader }
    }

    let result = await registry.execute(toolName, toolArgs, context, this.toolWhitelist, this.abortController?.signal)
    if (context.workingDir) {
      if (!this.config.terminal) this.config.terminal = {}
      this.config.terminal.cwd = context.workingDir
      this.memoryStore.setWorkingDir(context.workingDir)
    }
    if (result.length > 100_000) result = result.slice(0, 100_000) + '\n\n[... Truncated at 100K characters ...]'
    // Track real file edits so the verification nudge only fires after actual changes.
    if (toolName === 'write_file' || toolName === 'patch') {
      try {
        const parsed = JSON.parse(result)
        if (!parsed.error) {
          this.verificationBaselineChanged = true
          this.verification.markWorkspaceEdited()
          if (/\.(?:ts|tsx|mts|cts)$/i.test(String(parsed.path || toolArgs.path || ''))) {
            this.verificationTypescriptChanged = true
            this.verificationTypescriptVerified = false
          }
        }
      } catch {
        // Unparseable tool output means we cannot prove an edit landed.
      }
    }
    if (toolName === 'patch_batch' || toolName === 'apply_patch') {
      try {
        const parsed = JSON.parse(result)
        if (parsed.success && Array.isArray(parsed.files)) {
          this.verificationBaselineChanged = true
          this.verification.markWorkspaceEdited()
          if (parsed.files.some((file: any) => /\.(?:ts|tsx|mts|cts)$/i.test(String(file.path || '')))) {
            this.verificationTypescriptChanged = true
            this.verificationTypescriptVerified = false
          }
        }
      } catch {
        // Invalid tool output cannot prove files changed.
      }
    }
    // Record real verification evidence (test/build/lint runs), never blocking the turn.
    if (!this.isSubagent && toolName === 'terminal') {
      try {
        const parsed = JSON.parse(result)
        const exitCode = typeof parsed.exit_code === 'number' ? parsed.exit_code : null
        const output = `${parsed.output ?? ''}\n${parsed.stderr ?? ''}`
        this.verification.record(String(toolArgs.command || ''), exitCode, output)
        if (/\b(?:tsc|typecheck)\b/i.test(String(toolArgs.command || ''))) this.verificationTypescriptVerified = exitCode === 0
      } catch {
        // Non-JSON tool output is not verification evidence.
      }
    }
    const durationSec = (Date.now() - toolStart) / 1000
    safeCallback(callbacks?.onToolEnd, {
      id: toolCall.id, name: toolName, args: toolArgs, result,
      preview: formatToolEnd(toolName, toolArgs, result, durationSec)
    })
    return result
  }

  /** Ringkas history dengan model; false = pakai fallback lokal. */
  private async compactWithModel(preserveIndex: number, force: boolean, maxChars: number): Promise<boolean> {
    if (this.isSubagent || !this.summarizer) return false
    const startIndex = 1 // system prompt stays at index 0
    let endIndex = force && preserveIndex >= 0
      ? preserveIndex
      : Math.min(this.conversationHistory.length - 8, preserveIndex < 0 ? this.conversationHistory.length : preserveIndex)
    while (endIndex > startIndex && this.conversationHistory[endIndex]?.role === 'tool') endIndex--
    if (endIndex <= startIndex) return false
    const oldTurns = this.conversationHistory.slice(startIndex, endIndex)
    if (oldTurns.length < 4) return false

    const material = buildSummaryLines(oldTurns, [], maxChars * 3).join('\n')
    const summary = await summarizeWithProvider(this.summarizer, material, maxChars, this.abortController?.signal)
    if (!summary) return false

    const compactedMessage: Message = {
      role: 'user',
      content: `${SUMMARY_HEADER} (${oldTurns.length} messages compacted by model):\n${summary}\n${SUMMARY_FOOTER}`
    }
    const ackMessage: Message = { role: 'assistant', content: 'Summary noted. Continuing.' }
    this.conversationHistory.splice(startIndex, endIndex - startIndex, compactedMessage, ackMessage)
    return true
  }

  /** Prompt lanjutan untuk turn yang gagal di tengah; null kalau tidak ada. */
  resumePrompt(): string | null {
    const checkpoint = loadCheckpoint(this.checkpointDir, this.sessionId)
    if (!isCheckpointRelevant(checkpoint)) return null
    return buildResumePrompt(checkpoint!)
  }

  private buildSystemPrompt(): string {
    const skillsBlock = this.skillLoader.getFormattedIndex()
    const memoryBlock = this.memoryStore.formatForSystemPrompt()
    const todoBlock = this.todoStore.formatForInjection()
    const plainTextRule = ['# Output Format (terminal, plain text)',
      'Balasan tampil di terminal yang mencetak karakter mentah, jadi jangan pakai formatting markdown: tanpa bold, tanpa backtick, tanpa heading, tanpa tabel pipe. Tulis teks polos dengan bullet "- " atau numbering "1." bila perlu daftar. Baris kode/command ditulis apa adanya di barisnya sendiri.'].join('\n')
    const cwd = this.config.terminal?.cwd || process.cwd()
    const home = homedir()
    const hostOS = platform()
    const now = new Date()
    // BUG-11: Use local date/time, not UTC
    const dateStr = now.toLocaleDateString('en-CA') // YYYY-MM-DD
    const timeStr = now.toLocaleTimeString('en-GB', { hour12: false }) // HH:MM:SS

    const sections: string[] = [
      `You are Vallen AI Agent, an autonomous coding and task-execution agent embedded in Vallenatrix Terminal (Hermes-inspired architecture).
Be direct: match reply length to the ask — a one-line question gets a one-line answer; finished work gets a short report of what changed, what is verified, and what is next. No filler pleasantries ("I would be happy to", "Great question"), no restating requests back, no narrating obvious steps. Plain technical claims over adjectives.

# Finishing the Job
When asked to build, run, test, or verify something, the deliverable is a working artifact backed by real tool output — not a description or placeholder. Do not stop after writing a stub or a single command. Keep working until you have executed the code or produced the requested result.
For multi-step coding or execution work, create a todo_list checklist before implementation; use the exact tool name todo_list when updating work state, update it after each meaningful milestone, and mark an item complete only after its result is verified. Treat unfinished checklist items as unfinished work, including after a user says 'lanjut' or resumes a session. Do not ask again for information already present in the conversation; ask one concise question only when a missing decision blocks safe progress. Keep progress messages to one brief update when status changes; do not narrate every action. Final response must state what changed and what was actually verified. If blocked or stopped, say incomplete and list remaining work; never imply partial work is done.
If a tool, install, or command fails, diagnose directly and try alternatives. NEVER fabricate outputs or data.

# Tool-Use Enforcement
You MUST use your tools to take action — do not describe what you would do or plan to do without executing it. When you say you will perform an action (e.g. read file, patch, run tests), you MUST immediately make the corresponding tool call in the same response.

# Choose the Right Tool
For codebase work, inspect with search_files and read_file; make focused edits with patch. Before write_file overwrites an existing file, read its complete current contents with read_file; new files may be written directly. Prefer patch for targeted edits. Do NOT use terminal for file browsing, reading, searching, editing, or writing when a dedicated tool exists. Use terminal for commands that need execution, such as tests, builds, git operations, package scripts, and runtime checks. Use terminal background=true for long-running servers, notify=true for exit callbacks, then process_manage to poll, wait, or kill; process IDs belong to the current session. Deferred capabilities are not in the default schema: discover them with tool_search, inspect schema with tool_describe, then invoke via tool_call. For TypeScript edits, run a successful typecheck after the last edit; otherwise report task incomplete. Use patch_batch for related targeted edits and apply_patch for V4A Update/Add/Delete File operations. Before each command, know what result it is meant to verify; avoid repeated exploratory shell commands. Keep tool calls focused and report changed files plus verification in the final response.

# Indonesian Casual Language Understanding
Pahami bahasa santai/casual Indonesia (bang, lu, gw, gas, gasin, lanjut, yoi, sip, otw, terapkan, beresin). Jangan bertele-tele atau meminta konfirmasi berulang. Jika user memberi perintah atau mengatakan "gas"/"lanjut", langsung eksekusi tool yang tepat (patch, write_file, terminal, dsb) secara tuntas.

${plainTextRule}

# Runtime Environment
- Current Date: ${dateStr} ${timeStr}
- Host Platform: ${hostOS}
- User Home: ${home}
- Current Working Directory: ${cwd}
- Scratch Dir: ${join(home, '.vallenatrix', 'scratch')}`
    ]

    if (this.gameDevMode) {
      sections.push(`
# 🎮 GAME DEVELOPMENT MODE ACTIVE

You are now operating in specialized game development mode. Prioritize game engine patterns, asset workflows, and performance optimization.

## Core Focus Areas
- **Unity**: C# MonoBehaviour patterns, Scriptable Objects, Editor tools, DOTS/ECS architecture
- **Godot**: GDScript best practices, Node system, signals, multiplayer networking (RPCs, state sync)
- **Unreal**: C++ gameplay classes, Blueprints, Actor components, replication, engine source cross-reference
- **Roblox**: Lua scripting, RemoteEvents, DataStores, experience design
- **Blender**: Python scripting for asset automation, mesh ops, material nodes, export pipelines

## Mandatory Practices
1. **Performance First**: Always target 60+ FPS. Use object pooling for frequent instantiation. Cache component references — NEVER call GetComponent/GetNode in Update/\_process loops.
2. **Frame-Independent Code**: All movement/physics must use delta time. No hardcoded values.
3. **Engine Patterns**: Follow established patterns (Unity Scriptable Objects, Godot signals, Unreal replication). Do not reinvent engine-provided systems.
4. **Asset Workflow**: Automate repetitive tasks (sprite slicing, texture import, prefab generation). Write editor tools when manual work exceeds 3 repetitions.
5. **Shader Optimization**: Minimize texture samples, avoid branching in fragment shaders, use vertex shaders for static transforms.

## Load Game Dev Skills
When working on game tasks, ALWAYS load relevant skills from the available game development skills:
- game-designer, game-audio-engineer, level-designer, narrative-designer, technical-artist
- godot-gameplay-scripter, godot-multiplayer-engineer, godot-shader-developer
- unity-architect, unity-editor-tool-developer, unity-multiplayer-engineer, unity-shader-graph-artist
- unreal-multiplayer-architect, unreal-systems-engineer, unreal-technical-artist, unreal-world-builder
- roblox-avatar-creator, roblox-experience-designer, roblox-systems-scripter

Prefer engine-native solutions over custom implementations. Write tests for game logic (unit tests for systems, not editor-only MonoBehaviours).`)
    }

    if (memoryBlock) {
      sections.push(memoryBlock)
    }

    if (todoBlock) {
      sections.push(todoBlock)
    }

    if (skillsBlock) {
      sections.push(skillsBlock)
    }

    return sections.join('\n\n')
  }

  setToken(apiKey: string, providerName?: string): void {
    const targetProvider = providerName || this.config.providers.active
    const terminal = this.config.terminal
    const saved = setProviderToken(targetProvider, apiKey)
    this.config.providers = saved.providers
    this.config.terminal = terminal
    const activeProvider = getActiveProvider(this.config)
    this.provider = createProvider(
      activeProvider.name,
      activeProvider.base_url,
      activeProvider.api_key,
      activeProvider.model
    )
  }

  setModel(modelName: string, persist: boolean = true): void {
    const active = this.config.providers.active
    const provider = this.config.providers[active]
    if (provider && typeof provider === 'object') {
      provider.model = modelName
      
      if (persist) {
        // Save only provider config, skip runtime terminal.cwd
        const configToSave: Partial<AgentConfig> = {
          providers: this.config.providers,
          skills: this.config.skills,
          max_iterations: this.config.max_iterations
        }
        const terminal = this.config.terminal
        const saved = saveConfig(configToSave)
        Object.assign(this.config, saved, { terminal })
      }
      this.provider.model = modelName
    }
  }

  setGameDevMode(enabled: boolean): void {
    this.gameDevMode = enabled
  }

  getConfig(): AgentConfig {
    return this.config
  }

  reload(): void {
    this.skillLoader.reload()
  }

  private spawnBackgroundReview(callbacks?: AgentCallbacks): void {
    const conversationSnapshot = [...this.conversationHistory]
    const reviewConfig = { ...this.config, terminal: { ...this.config.terminal, cwd: this.memoryStore.getWorkingDir() } }
    
    spawnBackgroundReview(
      conversationSnapshot,
      async (userPrompt: string, systemPrompt: string, toolWhitelist: string[]) => {
        const reviewAgent = new AIAgent({
          config: reviewConfig,
          maxIterations: 10,
          isSubagent: true,
          lightweight: true,
          skillLoader: this.skillLoader
        })
        
        // Override system prompt and filter tools
        reviewAgent.toolWhitelist = toolWhitelist
        const res = await reviewAgent.chat(userPrompt, undefined, systemPrompt)
        
        return res.response
      },
      {
        onReviewComplete: callbacks?.onReviewComplete,
        onReviewError: callbacks?.onReviewError,
        onReviewFinished: () => this.backgroundReviewGate.finish()
      },
      this.memoryStore.formatForSystemPrompt()
    )
  }

  private syncBundledSkillsIfNeeded(): void {
    try {
      const manifest = readManifest()
      const manifestKeys = Object.keys(manifest)
      
      // First run if manifest empty or doesn't exist
      if (manifestKeys.length === 0) {
        logger.info('[Agent] First run detected, syncing bundled skills...')
        const result = syncBundledSkills()
        logger.info(`[Agent] Bundled skills synced: ${result.added.length} added, ${result.updated.length} updated, ${result.skipped.length} skipped`)
      }
    } catch (err) {
      logger.error('[Agent] Failed to sync bundled skills:', err)
    }
  }
}
