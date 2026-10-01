// Core agent loop - Hermes-inspired architecture

import { homedir, platform } from 'os'
import { join } from 'path'
import type { AgentConfig } from './types'
import type { Provider, Message } from './providers'
import type { ToolContext } from './tools'
import { createProvider } from './providers'
import { registry } from './tools'
import { SkillLoader } from './skills'
import { MemoryStore } from './memory'
import { TodoStore } from './todo'
import { SessionManager } from './session'
import { loadConfig, getActiveProvider, setProviderToken, saveConfig } from './config'
import { registerBuiltinTools } from './builtin_tools'
import { formatToolStart, formatToolEnd } from './display'

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
}

function pruneOldToolResults(messages: Message[], protectTailCount: number = 8): Message[] {
  if (messages.length <= protectTailCount) return messages
  const cutoffIndex = messages.length - protectTailCount
  return messages.map((m, idx) => {
    if (idx < cutoffIndex && m.role === 'tool' && m.content && m.content.length > 250) {
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
    this.skillLoader = new SkillLoader(skillPaths)
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
      this.setModel(data.model)
    }
    if (data.cwd) {
      if (!this.config.terminal) this.config.terminal = {}
      this.config.terminal.cwd = data.cwd
    }
    return true
  }

  resetSession(): void {
    this.conversationHistory = []
    this.sessionId = `session-${Date.now()}`
  }

  async chat(userMessage: string, callbacks?: AgentCallbacks, systemPrompt?: string): Promise<AgentResponse> {
    this.isInterrupted = false

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

    // Append user message to active history
    this.conversationHistory.push({ role: 'user', content: userMessage })

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

      const messages = pruneOldToolResults(this.conversationHistory, 8)
      const tools = registry.getOpenAISchemas()
      const response = await this.provider.chat({
        model: this.provider.model,
        messages,
        tools: tools.length > 0 ? tools : undefined
      })

      const choice = response.choices[0]
      const assistantMessage = choice.message

      // Track usage
      if (response.usage) {
        totalTokens += response.usage.total_tokens
        promptTokens += response.usage.prompt_tokens || 0
        completionTokens += response.usage.completion_tokens || 0
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
              ? JSON.parse(toolCall.function.arguments)
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
            workingDir: this.config.terminal?.cwd || process.cwd()
          }

          let result = await registry.execute(toolName, toolArgs, context)
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
      const finalContent = assistantMessage.content || ''
      
      // Guard: empty or promise-only response
      if (!finalContent.trim()) {
        if (iterations < 3) {
          this.conversationHistory.push({
            role: 'user',
            content: 'Your response was empty. Provide a response or make tool calls.'
          })
          continue
        }
      }
      
      // Guard: promise pattern without tool calls
      const promisePattern = /^(saya akan|i will|let me|gue bakal|i'll)\s/i
      if (finalContent.trim().length < 100 && promisePattern.test(finalContent.trim())) {
        if (iterations < 3) {
          this.conversationHistory.push({
            role: 'user',
            content: 'Act now with tool calls or provide final answer.'
          })
          continue
        }
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

      // Persist session to disk
      try {
        this.sessionManager.saveSession(
          this.sessionId,
          this.conversationHistory,
          this.config.terminal?.cwd || process.cwd(),
          this.provider.model
        )
      } catch {}

      return {
        response: assistantMessage.content || '',
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
    try {
      this.sessionManager.saveSession(
        this.sessionId,
        this.conversationHistory,
        this.config.terminal?.cwd || process.cwd(),
        this.provider.model
      )
    } catch {}
    
    return {
      response: `Max iterations reached (${this.maxIterations}). Work so far saved.`,
      iterations,
      totalTokens,
      toolCalls: toolCallCount,
      promptTokens,
      completionTokens
    }
  } catch (err: any) {
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
    
    // Save session even after error
    try {
      this.sessionManager.saveSession(
        this.sessionId,
        this.conversationHistory,
        this.config.terminal?.cwd || process.cwd(),
        this.provider.model
      )
    } catch {}
    
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
    const dateStr = now.toISOString().split('T')[0]
    const timeStr = now.toTimeString().split(' ')[0]

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
    if (this.provider.model === modelName) return
    
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

  getConfig(): AgentConfig {
    return this.config
  }

  reload(): void {
    this.skillLoader.reload()
  }
}
