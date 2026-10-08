import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, chmodSync } from 'fs'
import { join } from 'path'
import { getVallenatrixHome } from './config'
import type { Message } from './providers'

export interface SessionData {
  id: string
  title: string
  created_at: string
  updated_at: string
  cwd: string
  model: string
  messages: Message[]
}

export class SessionManager {
  private baseDir: string

  constructor(customDir?: string) {
    this.baseDir = customDir || join(getVallenatrixHome(), 'sessions')
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true, mode: 0o700 })
    }
    chmodSync(this.baseDir, 0o700)
    for (const file of readdirSync(this.baseDir).filter(name => name.endsWith('.json'))) {
      chmodSync(join(this.baseDir, file), 0o600)
    }
  }

  private getSessionPath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(this.baseDir, `${safeId}.json`)
  }

  saveSession(
    sessionId: string,
    messages: Message[],
    cwd: string = process.cwd(),
    model: string = 'ag/gemini-3.8-flash-medium'
  ): void {
    if (!messages || messages.length === 0) return
    this.ensureDir()

    let title = 'New Conversation'
    const firstUserMsg = messages.find(m => m.role === 'user')
    if (firstUserMsg && firstUserMsg.content) {
      title = firstUserMsg.content.slice(0, 45).replace(/\r?\n/g, ' ')
    }

    const now = new Date().toISOString()
    const filePath = this.getSessionPath(sessionId)
    let createdAt = now

    if (existsSync(filePath)) {
      try {
        const prev = JSON.parse(readFileSync(filePath, 'utf-8'))
        createdAt = prev.created_at || now
      } catch {}
    }

    const data: SessionData = {
      id: sessionId,
      title,
      created_at: createdAt,
      updated_at: now,
      cwd,
      model,
      messages
    }

    try {
      writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
      chmodSync(filePath, 0o600)
    } catch (err) {
      console.error('[SessionManager] Failed to save session:', err)
    }
  }

  loadSession(sessionId: string): SessionData | null {
    const filePath = this.getSessionPath(sessionId)
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as SessionData
    } catch {
      return null
    }
  }

  listSessions(): Array<{ id: string; title: string; updated_at: string; model: string }> {
    this.ensureDir()
    const result: Array<{ id: string; title: string; updated_at: string; model: string }> = []

    try {
      const files = readdirSync(this.baseDir).filter(f => f.endsWith('.json'))
      for (const file of files) {
        try {
          const content = JSON.parse(readFileSync(join(this.baseDir, file), 'utf-8'))
          result.push({
            id: content.id || file.replace('.json', ''),
            title: content.title || 'Untitled',
            updated_at: content.updated_at || '',
            model: content.model || 'unknown'
          })
        } catch {}
      }
    } catch {}

    // Sort newest first
    return result.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }

  deleteSession(sessionId: string): boolean {
    const filePath = this.getSessionPath(sessionId)
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath)
        return true
      } catch {}
    }
    return false
  }
}
