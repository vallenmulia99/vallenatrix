import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { getVallenatrixHome } from './config'

export interface MemoryOperation {
  action: 'add' | 'replace' | 'remove'
  target?: 'memory' | 'user'
  content?: string
  new_text?: string
  old_text?: string
}

export class MemoryStore {
  private static locks = new Map<string, Promise<void>>()
  private baseDir: string
  private memoryLimit: number = 2200
  private userLimit: number = 1375

  constructor(customDir?: string) {
    this.baseDir = customDir || join(getVallenatrixHome(), 'memories')
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true, mode: 0o700 })
    }
    chmodSync(this.baseDir, 0o700)
  }

  private getFilePath(target: 'memory' | 'user'): string {
    return join(this.baseDir, target === 'user' ? 'USER.md' : 'MEMORY.md')
  }

  private async locked<T>(fn: () => T): Promise<T> {
    const key = this.baseDir
    const previous = MemoryStore.locks.get(key) || Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    MemoryStore.locks.set(key, current)
    await previous
    try { return fn() } finally {
      release()
      if (MemoryStore.locks.get(key) === current) MemoryStore.locks.delete(key)
    }
  }

  private readEntries(target: 'memory' | 'user'): string[] {
    const file = this.getFilePath(target)
    if (!existsSync(file)) return []
    try {
      const text = readFileSync(file, 'utf-8').trim()
      if (!text) return []
      return text.split(/\n§\n/).map(e => e.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  private writeEntries(target: 'memory' | 'user', entries: string[]): { success: boolean; chars: number; limit: number; error?: string } {
    const file = this.getFilePath(target)
    const limit = target === 'user' ? this.userLimit : this.memoryLimit
    const joined = entries.join('\n§\n')

    if (joined.length > limit) {
      return {
        success: false,
        chars: joined.length,
        limit,
        error: `Exceeded char budget: ${joined.length}/${limit} chars for ${target}. Shorten or consolidate entries first.`
      }
    }

    try {
      this.ensureDir()
      const temp = `${file}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(temp, joined, { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
      chmodSync(temp, 0o600)
      renameSync(temp, file)
      return { success: true, chars: joined.length, limit }
    } catch (err: any) {
      return { success: false, chars: joined.length, limit, error: err.message || 'Write failed' }
    }
  }

  async add(target: 'memory' | 'user', content: string): Promise<Record<string, any>> {
    const trimmed = content.trim()
    if (!trimmed) return { error: 'Content cannot be empty' }
    return this.locked(() => { const entries = this.readEntries(target); entries.push(trimmed); return this.writeEntries(target, entries) })
  }

  async replace(target: 'memory' | 'user', oldText: string, newContent: string): Promise<Record<string, any>> {
    // BUG-13: Reject empty oldText
    if (!oldText.trim()) {
      return { error: 'old_text must not be empty for replace' }
    }
    
    return this.locked(() => {
    const entries = this.readEntries(target)
    const matches = entries.filter(e => e.toLowerCase().includes(oldText.toLowerCase()))
    
    if (matches.length === 0) {
      return { error: `No entry matching '${oldText}' found in ${target}` }
    }
    if (matches.length > 1) {
      return { error: `Found ${matches.length} entries matching '${oldText}'. Use more specific text.` }
    }
    
    const idx = entries.findIndex(e => e.toLowerCase().includes(oldText.toLowerCase()))
    entries[idx] = newContent.trim()
    return this.writeEntries(target, entries)
    })
  }

  async remove(target: 'memory' | 'user', oldText: string): Promise<Record<string, any>> {
    // BUG-13: Reject empty oldText
    if (!oldText.trim()) {
      return { error: 'old_text must not be empty for remove' }
    }
    
    return this.locked(() => {
    const entries = this.readEntries(target)
    const matches = entries.filter(e => e.toLowerCase().includes(oldText.toLowerCase()))
    
    if (matches.length === 0) {
      return { error: `No entry matching '${oldText}' found in ${target}` }
    }
    if (matches.length > 1) {
      return { error: `Found ${matches.length} entries matching '${oldText}'. Use more specific text.` }
    }
    
    const idx = entries.findIndex(e => e.toLowerCase().includes(oldText.toLowerCase()))
    entries.splice(idx, 1)
    return this.writeEntries(target, entries)
    })
  }

  async batch(operations: MemoryOperation[], defaultTarget: 'memory' | 'user' = 'memory'): Promise<Record<string, any>> {
    return this.locked(() => this.batchLocked(operations, defaultTarget))
  }

  private batchLocked(operations: MemoryOperation[], defaultTarget: 'memory' | 'user'): Record<string, any> {
    const memoryEntries = [...this.readEntries('memory')]
    const userEntries = [...this.readEntries('user')]

    // BUG-13: Process all ops in memory, validate, then write atomically
    for (const op of operations) {
      const target = op.target || defaultTarget
      const list = target === 'user' ? userEntries : memoryEntries
      const content = (op.content || op.new_text || '').trim()
      const oldText = (op.old_text || '').trim()

      if (op.action === 'add') {
        if (content) list.push(content)
        else return { error: 'content required for add in batch' }
      } else if (op.action === 'replace') {
        if (!oldText) {
          return { error: 'old_text required for replace in batch' }
        }
        const idx = list.findIndex(e => e.toLowerCase().includes(oldText.toLowerCase()))
        if (idx === -1) {
          return { error: `No entry matching '${oldText}' in ${target}` }
        }
        if (!content) return { error: 'content required for replace in batch' }
        list[idx] = content
      } else if (op.action === 'remove') {
        if (!oldText) {
          return { error: 'old_text required for remove in batch' }
        }
        const idx = list.findIndex(e => e.toLowerCase().includes(oldText.toLowerCase()))
        if (idx === -1) {
          return { error: `No entry matching '${oldText}' in ${target}` }
        }
        list.splice(idx, 1)
      }
    }

    // Validate limits before writing
    const memChars = memoryEntries.join('\n§\n').length
    const userChars = userEntries.join('\n§\n').length
    
    if (memChars > this.memoryLimit) {
      return { error: `Batch would exceed memory limit: ${memChars}/${this.memoryLimit} chars` }
    }
    if (userChars > this.userLimit) {
      return { error: `Batch would exceed user limit: ${userChars}/${this.userLimit} chars` }
    }

    const oldMem = [...this.readEntries('memory')]
    const oldUser = [...this.readEntries('user')]
    const resMem = this.writeEntries('memory', memoryEntries)
    if (!resMem.success) return resMem
    const resUser = this.writeEntries('user', userEntries)
    if (!resUser.success) {
      this.writeEntries('memory', oldMem)
      this.writeEntries('user', oldUser)
      return resUser
    }

    return {
      success: true,
      memory: { chars: resMem.chars, limit: resMem.limit },
      user: { chars: resUser.chars, limit: resUser.limit }
    }
  }

  formatForSystemPrompt(): string {
    const memEntries = this.readEntries('memory')
    const userEntries = this.readEntries('user')

    const memText = memEntries.join('\n§\n')
    const userText = userEntries.join('\n§\n')

    const blocks: string[] = []

    if (memText) {
      const memPct = Math.round((memText.length / this.memoryLimit) * 100)
      blocks.push(
        `══════════════════════════════════════════════\n` +
        `MEMORY (your personal notes) [${memPct}% — ${memText.length}/${this.memoryLimit} chars]\n` +
        `══════════════════════════════════════════════\n` +
        memText
      )
    }

    if (userText) {
      const userPct = Math.round((userText.length / this.userLimit) * 100)
      blocks.push(
        `══════════════════════════════════════════════\n` +
        `USER PROFILE (who the user is) [${userPct}% — ${userText.length}/${this.userLimit} chars]\n` +
        `══════════════════════════════════════════════\n` +
        userText
      )
    }

    return blocks.join('\n\n')
  }
}
