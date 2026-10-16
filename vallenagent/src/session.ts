import { logger } from './logger'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, chmodSync, renameSync, unlinkSync, openSync, readSync, closeSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { getVallenatrixHome } from './config'
import type { Message } from './providers'
import type { TodoItem } from './todo'

export interface SessionData {
  id: string
  title: string
  created_at: string
  updated_at: string
  cwd: string
  model: string
  messages: Message[]
  todos?: TodoItem[]
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

  private getSafeId(sessionId: string): string {
    const readable = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'session'
    const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
    return `${readable}-${hash}`
  }

  private getSessionPath(sessionId: string): string {
    return join(this.baseDir, `${this.getSafeId(sessionId)}.json`)
  }

  private getMetadataPath(sessionId: string): string {
    return join(this.baseDir, `${this.getSafeId(sessionId)}.meta.json`)
  }

  private getLegacyPath(sessionId: string): string {
    return join(this.baseDir, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
  }

  private writeAtomic(filePath: string, content: string): void {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    try {
      writeFileSync(tempPath, content, { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
      chmodSync(tempPath, 0o600)
      renameSync(tempPath, filePath)
    } catch (error) {
      try { unlinkSync(tempPath) } catch {}
      throw error
    }
  }

  private readLegacyMetadata(filePath: string): { id: string; title: string; created_at: string; updated_at: string; model: string } | null {
    const fd = openSync(filePath, 'r')
    try {
      const buffer = Buffer.alloc(8192)
      const bytes = readSync(fd, buffer, 0, buffer.length, 0)
      const header = buffer.subarray(0, bytes).toString('utf-8')
      const fields: Record<string, string> = {}
      for (const match of header.matchAll(/"(id|title|created_at|updated_at|model)"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
        try { fields[match[1]] = JSON.parse(match[2]) } catch {}
      }
      return fields.id && fields.title ? {
        id: fields.id, title: fields.title, created_at: fields.created_at || '', updated_at: fields.updated_at || '', model: fields.model || 'unknown'
      } : null
    } finally {
      closeSync(fd)
    }
  }

  saveSession(
    sessionId: string,
    messages: Message[],
    cwd: string = process.cwd(),
    model: string = 'ag/gemini-3.8-flash-medium',
    todos: TodoItem[] = []
  ): void {
    if (!messages || messages.length === 0) return
    this.ensureDir()

    let title = 'New Conversation'
    const firstUserMsg = messages.find(m => m.role === 'user')
    if (firstUserMsg && firstUserMsg.content) {
      const text = typeof firstUserMsg.content === 'string'
        ? firstUserMsg.content
        : Array.isArray(firstUserMsg.content)
          ? (firstUserMsg.content as any[]).map(p => typeof p === 'string' ? p : (p?.text || '')).join(' ')
          : ''
      title = text.slice(0, 45).replace(/\r?\n/g, ' ') || 'New Conversation'
    }

    const now = new Date().toISOString()
    const filePath = this.getSessionPath(sessionId)
    const metadataPath = this.getMetadataPath(sessionId)
    let createdAt = now
    let existingTitle: string | undefined
    if (existsSync(metadataPath)) {
      try {
        const previous = JSON.parse(readFileSync(metadataPath, 'utf-8'))
        createdAt = previous.created_at || now
        existingTitle = previous.title
      } catch {}
    } else {
      const legacyPath = this.getLegacyPath(sessionId)
      if (existsSync(legacyPath)) {
        try {
          const previous = JSON.parse(readFileSync(legacyPath, 'utf-8'))
          if (!previous.id || previous.id === sessionId) {
            createdAt = previous.created_at || now
            existingTitle = previous.title
          }
        } catch {}
      }
    }

    const data: SessionData = {
      id: sessionId,
      title: existingTitle || title,
      created_at: createdAt,
      updated_at: now,
      cwd,
      model,
      messages,
      todos: todos.map(todo => ({ ...todo }))
    }
    const metadata = { id: data.id, title: data.title, created_at: data.created_at, updated_at: data.updated_at, cwd: data.cwd, model: data.model }

    try {
      this.writeAtomic(filePath, JSON.stringify(data))
      this.writeAtomic(metadataPath, JSON.stringify(metadata))
    } catch (err) {
      logger.error('[SessionManager] Failed to save session:', err)
    }
  }

  loadSession(sessionId: string): SessionData | null {
    const filePath = existsSync(this.getSessionPath(sessionId)) ? this.getSessionPath(sessionId) : this.getLegacyPath(sessionId)
    if (!existsSync(filePath)) return null
    try {
      const session = JSON.parse(readFileSync(filePath, 'utf-8')) as SessionData
      return session.id && session.id !== sessionId ? null : session
    } catch {
      return null
    }
  }

  listSessions(): Array<{ id: string; title: string; created_at: string; updated_at: string; model: string }> {
    this.ensureDir()
    const result: Array<{ id: string; title: string; created_at: string; updated_at: string; model: string }> = []

    try {
      const files = readdirSync(this.baseDir)
      const metadataFiles = files.filter(file => file.endsWith('.meta.json'))
      const coveredSessionFiles = new Set(metadataFiles.map(file => `${file.slice(0, -'.meta.json'.length)}.json`))
      for (const file of metadataFiles) {
        try {
          const content = JSON.parse(readFileSync(join(this.baseDir, file), 'utf-8'))
          result.push({
            id: content.id || file.replace('.meta.json', ''),
            title: content.title || 'Untitled',
            created_at: content.created_at || '',
            updated_at: content.updated_at || '',
            model: content.model || 'unknown'
          })
        } catch {}
      }
      // Parse only the leading metadata fields in legacy sessions without a sidecar.
      for (const file of files.filter(file => file.endsWith('.json') && !file.endsWith('.meta.json') && !coveredSessionFiles.has(file))) {
        try {
          const content = this.readLegacyMetadata(join(this.baseDir, file))
          if (content) result.push(content)
        } catch {}
      }
    } catch {}

    // Sort newest first
    return result.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }

  deleteSession(sessionId: string): boolean {
    let deleted = false
    for (const filePath of [this.getSessionPath(sessionId), this.getMetadataPath(sessionId)]) {
      if (existsSync(filePath)) {
        try { unlinkSync(filePath); deleted = true } catch {}
      }
    }
    const legacyPath = this.getLegacyPath(sessionId)
    if (existsSync(legacyPath)) {
      try {
        const legacy = JSON.parse(readFileSync(legacyPath, 'utf-8'))
        if (legacy.id === sessionId) { unlinkSync(legacyPath); deleted = true }
      } catch {}
    }
    return deleted
  }

  clearAllSessions(): number {
    const sessions = this.listSessions()
    for (const session of sessions) this.deleteSession(session.id)
    return sessions.length
  }
}
