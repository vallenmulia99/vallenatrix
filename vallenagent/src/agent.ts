// Core agent loop - Hermes-inspired architecture

import { homedir, platform } from 'os'
import { join } from 'path'
import type { AgentConfig } from './types'
import type { Provider, Message } from './providers'
import type { ToolContext } from './tools'
import { createProvider } from './providers'
import { registry } from './tools'
import { SkillLoader } from './skills'
import { syncBundledSkills, readManifest } from './skills_sync'
import { MemoryStore } from './memory'
import { TodoStore } from './todo'
import { SessionManager } from './session'
import { loadConfig, getActiveProvider, setProviderToken, saveConfig } from './config'
import { registerBuiltinTools } from './builtin_tools'
import { formatToolStart, formatToolEnd } from './display'
import { spawnBackgroundReview, type ReviewCallbacks } from './background_review'
import { buildPlanPrompt } from './plan_prompt'

export interface AgentOptions {
  config?: AgentConfig
  maxIterations?: number
  sessionId?: string
  isSubagent?: boolean
}

export interface AgentResponse {
  response: string
  iterations: number
  totalTokens: number
  toolCalls: number
  promptTokens?: number
  completionTokens?: number
  latencySec?: number
  tokensPerSec?: number
  contextWindow?: number
}

export interface AgentCallbacks {
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

function pruneOldToolResults(messages: Message[], protectTailCount: number = 8, protectedStart = messages.length): Message[] {
  if (messages.length <= protectTailCount) return messages
  const cutoffIndex = messages.length - protectTailCount
  return messages.map((m, idx) => {
    if (idx < cutoffIndex && idx >= protectedStart && m.role === 'tool' && m.content && m.content.length > 250) {
      try {
        const parsed = JSON.parse(m.content)
        if (parsed.error || (typeof parsed.exit_code === 'number' && parsed.exit_code !== 0)) {
          return m
        }
      } catch {}
      return {
        ...m,
        content: `[Output of ${m.name || 'tool'} (${m.content.length} chars) pruned. Re-run tool if needed.]`
      }
    }
    return m
  })
}

function compactHistory(history: Message[], keepTailCount: number = 8, preserveIndex = -1): boolean {
  if (history.length <= keepTailCount + 2) return false
  const startIndex = 1 // preserve system prompt at index 0
  let endIndex = Math.min(history.length - keepTailCount, preserveIndex < 0 ? history.length : preserveIndex)
  while (endIndex > startIndex && history[endIndex]?.role === 'tool') endIndex--
  if (endIndex <= startIndex) return false

  // Extract key summary points from old messages
  const oldTurns = history.slice(startIndex, endIndex)
  const summaries: string[] = []
  
  for (const m of oldTurns) {
    if (m.role === 'user') {
      const txt = (m.content || '').slice(0, 120).replace(/\n/g, ' ')
      summaries.push(`User: "${txt}"`)
    } else if (m.role === 'assistant' && m.content) {
      const txt = m.content.slice(0, 120).replace(/\n/g, ' ')
      summaries.push(`Agent: "${txt}"`)
    } else if (m.role === 'tool' && m.name) {
      summaries.push(`Tool: ${m.name}`)
    }
  }

  const compactedMessage: Message = {
    role: 'user',
    content: `[Previous conversation summary (${oldTurns.length} messages compacted):\n${summaries.slice(0, 15).join('\n')}\n(Continue task with full awareness of above context)]`
  }
  const ackMessage: Message = {
    role: 'assistant',
    content: 'Understood. I retain the summarized context and will proceed with the task.'
  }

  history.splice(startIndex, endIndex - startIndex, compactedMessage, ackMessage)
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
  private isInterrupted: boolean = false
  private conversationHistory: Message[] = []
  private chatLock: Promise<unknown> = Promise.resolve()
  private chatActive = false
  private abortController: AbortController | null = null

  private gameDevMode: boolean = false
  public toolWhitelist: string[] | undefined

  constructor(options: AgentOptions = {}) {
    this.config = options.config || loadConfig()
    this.maxIterations = options.maxIterations || this.config.max_iterations || 500
    this.sessionId = options.sessionId || `session-${Date.now()}`
    this.isSubagent = Boolean(options.isSubagent)
    this.sessionManager = new SessionManager()

    // Initialize provider
    const activeProvider = getActiveProvider(this.config)
    this.provider = createProvider(
      activeProvider.name,
      activeProvider.base_url,
      activeProvider.api_key,
      activeProvider.model
    )

    // Initialize skill loader
    const skillPaths = this.config.skills?.paths || []
    const skillConfig = {
      disabled: this.config.skills?.disabled || [],
      enabled: this.config.skills?.enabled || []
    }
    this.skillLoader = new SkillLoader(skillPaths, skillConfig)
    
    // Auto-sync bundled skills on first run
    this.syncBundledSkillsIfNeeded()
    
    this.skillLoader.load()

    // Initialize memory and todo stores
    this.memoryStore = new MemoryStore()
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

  interrupt(): void {
    this.isInterrupted = true
    // BUG-18: Abort ongoing provider/tool calls
    if (this.abortController) {
      this.abortController.abort()
    }

  }

  getSessionId(): string {
    return this.sessionId
  }

  resumeSession(targetSessionId: string): boolean {
    const data = this.sessionManager.loadSession(targetSessionId)
    if (!data) return false

    this.sessionId = data.id
    this.conversationHistory = data.messages || []
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

  resetSession(): void {
    if (this.chatActive) {
      // Reset cannot safely mutate history while serialized chat is active.
      this.interrupt()
      const resetAfterTurn = this.chatLock.then(() => { this.resetSession() })
      this.chatLock = resetAfterTurn
      return
    }
    this.conversationHistory = []
    this.sessionId = `session-${Date.now()}`
    // BUG-20: Clear todo store on session reset
    this.todoStore.write([])
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
      releaseLock()
    }
  }

  private async _chatImpl(userMessage: string, callbacks?: AgentCallbacks, systemPrompt?: string): Promise<AgentResponse> {
    this.isInterrupted = false
    const turnModel = this.provider.model
    
    // BUG-18: Create AbortController for this turn
    this.abortController = new AbortController()

    // Save history length before this turn starts (for BUG-08 clean rollback)
    const historyLenBeforeTurn = this.conversationHistory.length

    // Rebuild system prompt every turn (fresh context)
    if (this.conversationHistory.length === 0) {
      const initialSystemPrompt = systemPrompt || this.buildSystemPrompt()
      this.conversationHistory.push({ role: 'system', content: initialSystemPrompt })
    } else {
      this.conversationHistory[0] = {
        role: 'system',
        content: systemPrompt || this.buildSystemPrompt()
      }
    }

    // /plan built-in: rewrite turn to plan-mode prompt (Hermes pattern)
    let effectiveUserMessage = userMessage
    const trimmedUserMsg = userMessage.trim()
    if (/^\/plan(?:\s|$)/.test(trimmedUserMsg)) {
      const task = trimmedUserMsg.length > 5 ? trimmedUserMsg.slice(5).trim() : ''
      effectiveUserMessage = buildPlanPrompt(task)
    }

    // Append user message to active history
    this.conversationHistory.push({ role: 'user', content: effectiveUserMessage })
    const userEntry = this.conversationHistory[this.conversationHistory.length - 1]
    const words = new Set(effectiveUserMessage.toLowerCase().match(/[a-z0-9]+/g) || [])
    const ignored = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'buat', 'bikin', 'bikinin', 'tolong', 'please', 'page'])
    const messageLower = effectiveUserMessage.toLowerCase()
    const matchedSkill = this.skillLoader.list().map(skill => ({
      skill,
      score: skill.metadata.triggers?.some(trigger => trigger && messageLower.includes(trigger.toLowerCase())) ? 100 :
        [...words].filter(word => word.length > 2 && !ignored.has(word) && `${skill.name} ${skill.metadata.description}`.toLowerCase().includes(word)).length
    })).filter(item => item.score > 0).sort((a, b) => b.score - a.score)[0]?.skill
    if (matchedSkill) {
      const args = { name: matchedSkill.name }
      const id = `preload-${matchedSkill.name}`
      try { callbacks?.onToolStart?.({ id, name: 'skill_view', args, preview: `preparing skill_view ${matchedSkill.name}` }) } catch {}
      userEntry.content += `\n\n[Loaded skill: ${matchedSkill.name}]\n${matchedSkill.content}`
      const result = `# skill ${matchedSkill.name}\n\n${matchedSkill.content}`
      try { callbacks?.onToolEnd?.({ id, name: 'skill_view', args, result, preview: `skill ${matchedSkill.name}` }) } catch {}
    }

    const messages = this.conversationHistory

    const startTime = Date.now()
    let iterations = 0
    let totalTokens = 0
    let promptTokens = 0
    let completionTokens = 0
    let toolCallCount = 0
    const startHistoryLen = this.conversationHistory.length

    // Agent loop - mirroring Hermes conversation_loop.py
    try {
      while (iterations < this.maxIterations) {
      if (this.isInterrupted) {
        this.isInterrupted = false
        const interruptedMsg = '\x1b[33m[Execution halted: Turn interrupted by user /stop]\x1b[0m'
        return {
          response: interruptedMsg,
          iterations,
          totalTokens,
          toolCalls: toolCallCount
        }
      }

      iterations++

      callbacks?.onThinking?.(`Running iteration ${iterations}...`)

      // Auto-compaction if conversation history grows long
      if (this.conversationHistory.length > 20) {
        compactHistory(this.conversationHistory, 8, startHistoryLen - 1)
      }

      const messages = pruneOldToolResults(this.conversationHistory, 8, startHistoryLen - 1)
      let tools = registry.getOpenAISchemas([], this.toolWhitelist)
      if (this.isSubagent) {
        tools = tools.filter(t => t.function.name !== 'delegate_task')
      }
      const response = await this.provider.chat({
        model: turnModel,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        signal: this.abortController?.signal,  // BUG-18: Pass abort signal
        stream: Boolean(callbacks?.onChunk),
        onChunk: callbacks?.onChunk
      })

      const choice = response.choices[0]
      const assistantMessage = choice.message

      // BUG-19: Track usage correctly (use prompt_tokens for context %)
      if (response.usage) {
        // totalTokens accumulates duplicates across iterations - use prompt_tokens
        promptTokens = response.usage.prompt_tokens || 0
        completionTokens += response.usage.completion_tokens || 0
        totalTokens = promptTokens + completionTokens
      }

      // Format assistant message to be strictly OpenAI/Gemini compliant
      const sanitizedAssistantMsg: Message = {
        role: 'assistant',
        content: assistantMessage.content || '',
        tool_calls: assistantMessage.tool_calls
      }

      // Add assistant message to history
      this.conversationHistory.push(sanitizedAssistantMsg)

      // Check for tool calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        toolCallCount += assistantMessage.tool_calls.length

        // Execute tools
        for (const toolCall of assistantMessage.tool_calls) {
          if (this.isInterrupted) {
            this.conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: JSON.stringify({ skipped: 'User interrupted execution' })
            })
            continue
          }

          const toolName = toolCall.function.name
          let toolArgs: Record<string, any> = {}
          let parseError: string | null = null
          try {
            toolArgs = typeof toolCall.function.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments.trim() || '{}')
              : toolCall.function.arguments || {}
          } catch (err: any) {
            parseError = err.message
          }

          if (parseError) {
            this.conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify({ error: `Invalid JSON arguments: ${parseError}. Resend with valid JSON.` })
            })
            continue
          }

          const toolStart = Date.now()
          const startPreview = formatToolStart(toolName, toolArgs)
          callbacks?.onToolStart?.({
            id: toolCall.id,
            name: toolName,
            args: toolArgs,
            preview: startPreview
          })

          const context: ToolContext = {
            sessionId: this.sessionId,
            workingDir: this.config.terminal?.cwd || process.cwd(),
            isSubagent: this.isSubagent,
            stores: {
              memory: this.memoryStore,
              todo: this.todoStore,
              skillLoader: this.skillLoader
            }
          }

          let result = await registry.execute(toolName, toolArgs, context, this.toolWhitelist, this.abortController?.signal)
          const durationSec = (Date.now() - toolStart) / 1000

          if (context.workingDir) {
            if (!this.config.terminal) this.config.terminal = {}
            this.config.terminal.cwd = context.workingDir
          }

          // Truncate gigantic tool results if over 100K chars
          if (result.length > 100_000) {
            result = result.slice(0, 100_000) + '\n\n[... Truncated at 100K characters ...]'
          }

          const endPreview = formatToolEnd(toolName, toolArgs, result, durationSec)
          callbacks?.onToolEnd?.({
            id: toolCall.id,
            name: toolName,
            args: toolArgs,
            result,
            preview: endPreview
          })

          // Add tool result message to history
          this.conversationHistory.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: result
          })
        }

        // Continue loop for next iteration
        continue
      }

      // No tool calls - agent finished
      let finalContent = assistantMessage.content || ''
      if (!finalContent.trim()) {
        finalContent = '(No content returned by model. Please retry or rephrase your prompt.)'
        sanitizedAssistantMsg.content = finalContent
      }

      const latencySec = (Date.now() - startTime) / 1000
      const tokensPerSec = completionTokens > 0 && latencySec > 0 ? Math.round(completionTokens / latencySec) : 0
      const contextWindow = 1_048_576

      callbacks?.onTelemetry?.({
        totalTokens,
        promptTokens,
        completionTokens,
        latencySec,
        tokensPerSec,
        contextWindow
      })

      // Persist session to disk (skip for subagents - BUG-20)
      if (!this.isSubagent) {
        try {
          this.sessionManager.saveSession(
            this.sessionId,
            this.conversationHistory,
            this.config.terminal?.cwd || process.cwd(),
            this.provider.model
          )
        } catch {}
      }

      // Spawn background review (parent agent only, successful turns)
      if (!this.isSubagent && iterations > 0) {
        this.spawnBackgroundReview(callbacks)
      }

      return {
        response: finalContent,
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

    // Max iterations reached
    if (!this.isSubagent) {
      try {
        this.sessionManager.saveSession(
          this.sessionId,
          this.conversationHistory,
          this.config.terminal?.cwd || process.cwd(),
          this.provider.model
        )
      } catch {}
    }
    
    return {
      response: `Max iterations reached (${this.maxIterations}). Work so far saved.`,
      iterations,
      totalTokens,
      toolCalls: toolCallCount,
      promptTokens,
      completionTokens
    }
  } catch (err: any) {
    // BUG-08: Rollback user message if no progress made
    const progressMade = this.conversationHistory.some((m, idx) => idx >= startHistoryLen && m.role === 'assistant')
    
    if (!progressMade) {
      // No assistant/tool messages added, rollback to before the turn started
      while (this.conversationHistory.length > historyLenBeforeTurn) {
        this.conversationHistory.pop()
      }
    }
    
    // Rollback incomplete assistant messages or close hanging tool_calls
    while (this.conversationHistory.length > startHistoryLen) {
      const last = this.conversationHistory[this.conversationHistory.length - 1]
      if (last.role === 'assistant' && last.tool_calls) {
        const toolCalls = last.tool_calls
        let allClosed = true
        for (const tc of toolCalls) {
          const hasResult = this.conversationHistory.some(m => m.role === 'tool' && m.tool_call_id === tc.id)
          if (!hasResult) {
            this.conversationHistory.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.function.name,
              content: JSON.stringify({ error: 'Provider error before tool execution' })
            })
            allClosed = false
          }
        }
        if (allClosed) break
      } else {
        break
      }
    }
    
    // BUG-18: Check if aborted, save session and return gracefully
    if (err?.name === 'AbortError') {
      // Save session even on interrupt (skip if subagent)
      if (!this.isSubagent) {
        try {
          this.sessionManager.saveSession(
            this.sessionId,
            this.conversationHistory,
            this.config.terminal?.cwd || process.cwd(),
            this.provider.model
          )
        } catch {}
      }
      
      return {
        response: '\n\n[Interrupted by user]',
        iterations: 0,
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencySec: 0,
        tokensPerSec: 0,
        contextWindow: 1_048_576,
        toolCalls: 0
      }
    }
    
    // Save session even after error (skip if subagent)
    if (!this.isSubagent) {
      try {
        this.sessionManager.saveSession(
          this.sessionId,
          this.conversationHistory,
          this.config.terminal?.cwd || process.cwd(),
          this.provider.model
        )
      } catch {}
    }
    
    throw err
  }
}

  private buildSystemPrompt(): string {
    const skillsBlock = this.skillLoader.getFormattedIndex()
    const memoryBlock = this.memoryStore.formatForSystemPrompt()
    const todoBlock = this.todoStore.formatForInjection()
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
If a tool, install, or command fails, diagnose directly and try alternatives. NEVER fabricate outputs or data.

# Tool-Use Enforcement
You MUST use your tools to take action — do not describe what you would do or plan to do without executing it. When you say you will perform an action (e.g. read file, patch, run tests), you MUST immediately make the corresponding tool call in the same response.

# Indonesian Casual Language Understanding
Pahami bahasa santai/casual Indonesia (bang, lu, gw, gas, gasin, lanjut, yoi, sip, otw, terapkan, beresin). Jangan bertele-tele atau meminta konfirmasi berulang. Jika user memberi perintah atau mengatakan "gas"/"lanjut", langsung eksekusi tool yang tepat (patch, write_file, terminal, dsb) secara tuntas.

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
    this.config = setProviderToken(targetProvider, apiKey)
    const activeProvider = getActiveProvider(this.config)
    this.provider = createProvider(
      activeProvider.name,
      activeProvider.base_url,
      activeProvider.api_key,
      activeProvider.model
    )
  }

  setModel(modelName: string): void {
    const active = this.config.providers.active
    const provider = this.config.providers[active]
    if (provider && typeof provider === 'object') {
      provider.model = modelName
      
      // Save only provider config, skip runtime terminal.cwd
      const configToSave: Partial<AgentConfig> = {
        providers: this.config.providers,
        skills: this.config.skills,
        max_iterations: this.config.max_iterations
      }
      this.config = saveConfig(configToSave)
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
    
    spawnBackgroundReview(
      conversationSnapshot,
      async (userPrompt: string, systemPrompt: string, toolWhitelist: string[]) => {
        const reviewAgent = new AIAgent({
          config: this.config,
          maxIterations: 10,
          isSubagent: true
        })
        
        // Override system prompt and filter tools
        reviewAgent.toolWhitelist = toolWhitelist
        const res = await reviewAgent.chat(userPrompt, undefined, systemPrompt)
        
        return res.response
      },
      {
        onReviewComplete: callbacks?.onReviewComplete,
        onReviewError: callbacks?.onReviewError
      }
    )
  }

  private syncBundledSkillsIfNeeded(): void {
    try {
      const manifest = readManifest()
      const manifestKeys = Object.keys(manifest)
      
      // First run if manifest empty or doesn't exist
      if (manifestKeys.length === 0) {
        console.log('[Agent] First run detected, syncing bundled skills...')
        const result = syncBundledSkills()
        console.log(`[Agent] Bundled skills synced: ${result.added.length} added, ${result.updated.length} updated, ${result.skipped.length} skipped`)
      }
    } catch (err) {
      console.error('[Agent] Failed to sync bundled skills:', err)
    }
  }
}
