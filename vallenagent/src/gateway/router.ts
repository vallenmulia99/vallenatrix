import { join } from 'path'
import { AIAgent } from '../agent'
import { requiresApproval } from '../approval'
import { handleCommand } from '../commands'
import { loadConfig } from '../config'
import { SessionManager } from '../session'
import { gatewayDir, loadTelegramConfig } from './store'
import { stripAnsi } from './format'
import { unlinkSync } from 'fs'

export interface RemoteTransport {
  send(chatId: number, text: string): Promise<void>
  finish(chatId: number, text: string): Promise<void>
  typing(chatId: number): Promise<void>
  progress(chatId: number, text: string): Promise<void>
  approve(chatId: number, userId: number, text: string): Promise<boolean>
}

interface TurnRequest {
  text: string
  transport: RemoteTransport
  imagePath?: string
}

interface ChatState {
  agent: AIAgent
  prefix: string
  queue: TurnRequest[]
  running: boolean
}

const REMOTE_SYSTEM_PROMPT = `\n\n# Remote Telegram Session\nThe user is controlling this agent from a phone. Keep replies concise, avoid ANSI escape codes, do not paste huge command output, and offer to send large results as a file.`

export class SessionRouter {
  private chats = new Map<number, ChatState>()
  private active = 0
  private readonly maxActive = 2
  private readonly maxQueued = 3
  private lastScheduledUserId: number | null = null

  enqueue(userId: number, text: string, transport: RemoteTransport, imagePath?: string): boolean {
    const chat = this.getChat(userId)
    const cmd = text.trim().split(/\s+/, 1)[0]?.toLowerCase()
    if (cmd === '/stop' || cmd === '/status') {
      if (imagePath) { try { unlinkSync(imagePath) } catch {} }
      void this.runImmediate(chat, userId, text, transport)
      return true
    }
    if (chat.queue.length >= this.maxQueued) return false
    chat.queue.push({ text, transport, imagePath })
    this.pump()
    return true
  }

  private getChat(userId: number): ChatState {
    const existing = this.chats.get(userId)
    if (existing) return existing
    const prefix = `tg-${userId}-`
    const config = structuredClone(loadConfig())
    const gateway = config.gateway || {}
    const sessionsDir = join(gatewayDir(), 'telegram', 'sessions')
    const sessionManager = new SessionManager(sessionsDir)
    const previous = sessionManager.listSessions().find(session => session.id.startsWith(prefix))
    config.terminal = { cwd: process.cwd() }
    const agent = new AIAgent({
      config,
      sessionId: previous?.id || `${prefix}${Date.now()}`,
      sessionDir: sessionsDir,
      maxIterations: config.gateway?.telegram?.max_iterations || 60,
      backgroundReview: gateway.background_review ?? false
    })
    if (previous) agent.resumeSession(previous.id)
    const state: ChatState = { agent, prefix, queue: [], running: false }
    this.chats.set(userId, state)
    return state
  }

  private async runImmediate(chat: ChatState, userId: number, text: string, transport: RemoteTransport): Promise<void> {
    try {
      const result = await handleCommand({ channel: 'remote', agent: chat.agent, userId, sessionPrefix: chat.prefix, busy: chat.running }, text)
      if (result.handled) await transport.send(userId, result.response)
    } catch (error) {
      try { await transport.send(userId, `Perintah gagal: ${error instanceof Error ? error.message : 'error tidak diketahui'}`) } catch {}
    }
  }

  private pump(): void {
    if (this.active >= this.maxActive) return
    const entries = [...this.chats.entries()]
    const cursorIndex = entries.findIndex(([userId]) => userId === this.lastScheduledUserId)
    const ordered = cursorIndex < 0 ? entries : [...entries.slice(cursorIndex + 1), ...entries.slice(0, cursorIndex + 1)]
    for (const [userId, chat] of ordered) {
      if (this.active >= this.maxActive) break
      if (chat.running || chat.queue.length === 0) continue
      this.lastScheduledUserId = userId
      const next = chat.queue.shift()!
      chat.running = true
      this.active++
      void this.runTurn(userId, chat, next).catch(error => {
        console.warn(`[Gateway] turn failed: ${error instanceof Error ? error.message : String(error)}`)
      }).finally(() => {
        chat.running = false
        this.active--
        this.pump()
      })
    }
  }

  private async runTurn(userId: number, chat: ChatState, request: TurnRequest): Promise<void> {
    const { transport, text } = request
    try {
      const command = await handleCommand({ channel: 'remote', agent: chat.agent, userId, sessionPrefix: chat.prefix }, text)
      if (command.handled) {
        await transport.send(userId, command.response)
        return
      }
    } catch (error) {
      try { await transport.send(userId, `Perintah gagal: ${error instanceof Error ? error.message : 'error tidak diketahui'}`) } catch {}
      return
    }

    let typing = true
    const typingTimer = setInterval(() => { if (typing) void transport.typing(userId).catch(() => {}) }, 4000)
    const timeoutMs = chat.agent.config.gateway?.telegram?.turn_timeout_ms || 15 * 60_000
    const timeout = setTimeout(() => chat.agent.interrupt(), timeoutMs)
    let lastProgressAt = 0
    try {
      const prompt = request.imagePath
        ? `${text || 'Tolong analisis gambar ini.'}\n\nA user sent an image saved locally at ${request.imagePath}. Use the vision_analyze tool to inspect it and answer the user's caption or question.`
        : text
      const result = await chat.agent.chat(prompt, {
        onToolStart: info => {
          const now = Date.now()
          if (now - lastProgressAt >= 2000) {
            lastProgressAt = now
            void transport.progress(userId, `⏳ ${stripAnsi(info.preview).slice(0, 300)}`).catch(() => {})
          }
        },
        onBeforeTool: async info => {
          const config = loadTelegramConfig()
          const mode = loadConfig().gateway?.telegram?.approval || config.approval
          if (!requiresApproval({ name: info.name, args: info.args }, mode)) return true
          const summary = info.name === 'terminal'
            ? `Tool: ${info.name}\nCommand: ${String(info.args.command || '').slice(0, 1500)}`
            : `Izinkan tool ${info.name} dijalankan?`
          return transport.approve(userId, userId, summary)
        }
      }, chat.agent.getSystemPrompt(REMOTE_SYSTEM_PROMPT))
      const reply = stripAnsi(result.response)
      await transport.finish(userId, reply || 'Agent selesai tanpa balasan teks.')
    } catch (error) {
      await transport.send(userId, `Terjadi error saat agent bekerja: ${error instanceof Error ? error.message : 'error tidak diketahui'}`)
    } finally {
      typing = false
      clearInterval(typingTimer)
      clearTimeout(timeout)
      if (request.imagePath) {
        try { unlinkSync(request.imagePath) } catch {}
      }
    }
  }
}