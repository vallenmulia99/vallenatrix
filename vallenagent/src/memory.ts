import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface MemoryOperation {
  action: 'add' | 'replace' | 'remove'
  target?: 'memory' | 'user'
  content?: string
  new_text?: string
  old_text?: string
}

export class MemoryStore {
  private baseDir: string
  private memoryLimit: number = 2200
  private userLimit: number = 1375

  constructor(customDir?: string) {
    this.baseDir = customDir || join(homedir(), '.vallenatrix', 'memories')
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true })
    }
  }

  private getFilePath(target: 'memory' | 'user'): string {
    return join(this.baseDir, target === 'user' ? 'USER.md' : 'MEMORY.md')
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
      writeFileSync(file, joined, 'utf-8')
      return { success: true, chars: joined.length, limit }
    } catch (err: any) {
      return { success: false, chars: joined.length, limit, error: err.message || 'Write failed' }
    }
  }

  add(target: 'memory' | 'user', content: string): Record<string, any> {
    const trimmed = content.trim()
    if (!trimmed) return { error: 'Content cannot be empty' }
    const entries = this.readEntries(target)
    entries.push(trimmed)
    return this.writeEntries(target, entries)
  }

  replace(target: 'memory' | 'user', oldText: string, newContent: string): Record<string, any> {
    const entries = this.readEntries(target)
    const idx = entries.findIndex(e => e.toLowerCase().includes(oldText.toLowerCase()))
    if (idx === -1) {
      return { error: `No entry matching '${oldText}' found in ${target}` }
    }
    entries[idx] = newContent.trim()
    return this.writeEntries(target, entries)
  }

  remove(target: 'memory' | 'user', oldText: string): Record<string, any> {
    const entries = this.readEntries(target)
    const idx = entries.findIndex(e => e.toLowerCase().includes(oldText.toLowerCase()))
    if (idx === -1) {
      return { error: `No entry matching '${oldText}' found in ${target}` }
    }
    entries.splice(idx, 1)
    return this.writeEntries(target, entries)
  }

  batch(operations: MemoryOperation[], defaultTarget: 'memory' | 'user' = 'memory'): Record<string, any> {
    const memoryEntries = this.readEntries('memory')
    const userEntries = this.readEntries('user')

    for (const op of operations) {
      const target = op.target || defaultTarget
      const list = target === 'user' ? userEntries : memoryEntries
      const content = (op.content || op.new_text || '').trim()
      const oldText = (op.old_text || '').trim()

      if (op.action === 'add') {
        if (content) list.push(content)
      } else if (op.action === 'replace') {
        const idx = list.findIndex(e => e.toLowerCase().includes(oldText.toLowerCase()))
        if (idx !== -1 && content) list[idx] = content
      } else if (op.action === 'remove') {
        const idx = list.findIndex(e => e.toLowerCase().includes(oldText.toLowerCase()))
        if (idx !== -1) list.splice(idx, 1)
      }
    }

    const resMem = this.writeEntries('memory', memoryEntries)
    if (!resMem.success) return resMem
    const resUser = this.writeEntries('user', userEntries)
    if (!resUser.success) return resUser

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
