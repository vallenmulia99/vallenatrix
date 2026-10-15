import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Session search — cari kembali pekerjaan lama dari riwayat sesi yang tersimpan.
 *
 * Skema file sesi memakai JSON; pencarian dilakukan dengan membaca file dan
 * mencocokkan teks (bukan SQLite/FTS) supaya tidak ada dependensi baru. Sesi
 * yang jauh lebih banyak bisa dipindah ke indeks terpisah tanpa mengubah API ini.
 */

export interface SessionHit {
  sessionId: string
  file: string
  score: number
  snippet: string
  matchedTerms: string[]
}

const MAX_FILES = 400
const SNIPPET_CHARS = 240
const STOPWORDS = new Set([
  'yang', 'dan', 'untuk', 'dengan', 'dari', 'itu', 'ini', 'ada', 'tidak', 'bisa',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'not', 'you', 'are'
])

function sessionDirs(): string[] {
  const home = process.env.VALLENATRIX_HOME || join(homedir(), '.vallenatrix')
  const dirs = [join(home, 'sessions'), join(home, 'gateway', 'telegram', 'sessions')]
  return dirs.filter(dir => existsSync(dir))
}

export function tokenize(query: string): string[] {
  return [...new Set(
    String(query || '')
      .toLowerCase()
      .split(/[^a-z0-9_.\-]+/)
      .filter(term => term.length >= 3 && !STOPWORDS.has(term))
  )].slice(0, 12)
}

function readMessages(file: string): Array<{ role?: string; content?: string }> {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    if (Array.isArray(raw)) return raw
    if (raw && Array.isArray(raw.messages)) return raw.messages
    if (raw && Array.isArray(raw.history)) return raw.history
    return []
  } catch {
    return []
  }
}

function snippetAround(text: string, index: number): string {
  const start = Math.max(0, index - Math.floor(SNIPPET_CHARS / 3))
  const slice = text.slice(start, start + SNIPPET_CHARS).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${slice}${start + SNIPPET_CHARS < text.length ? '…' : ''}`
}

/**
 * Cari sesi lama. Skor = jumlah kemunculan term (role 'user' dihitung 2x, karena
 * permintaan user lebih menentukan topik daripada balasan agent).
 */
export function searchSessions(query: string, options: { limit?: number; dirs?: string[] } = {}): SessionHit[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50))
  const dirs = options.dirs ?? sessionDirs()

  const files: string[] = []
  for (const dir of dirs) {
    let entries: string[] = []
    try {
      entries = readdirSync(dir).filter(name => name.endsWith('.json'))
    } catch {
      continue
    }
    for (const name of entries) files.push(join(dir, name))
    if (files.length >= MAX_FILES) break
  }

  const hits: SessionHit[] = []
  for (const file of files.slice(0, MAX_FILES)) {
    const messages = readMessages(file)
    if (messages.length === 0) continue

    let score = 0
    let bestSnippet = ''
    let bestIsUser = false
    const matched = new Set<string>()

    for (const message of messages) {
      // System prompts repeat every session and would dominate both score and snippet.
      if (message.role === 'system') continue
      const content = typeof message.content === 'string' ? message.content : ''
      if (!content) continue
      const lower = content.toLowerCase()
      const weight = message.role === 'user' ? 2 : 1
      for (const term of terms) {
        let index = lower.indexOf(term)
        while (index !== -1) {
          score += weight
          matched.add(term)
          // Prefer a user-role snippet: it shows the request, not boilerplate.
          if (!bestSnippet || (message.role === 'user' && !bestIsUser)) {
            bestSnippet = snippetAround(content, index)
            bestIsUser = message.role === 'user'
          }
          index = lower.indexOf(term, index + term.length)
          if (score > 10_000) break
        }
      }
    }

    if (score > 0) {
      hits.push({ sessionId: file.split('/').pop()!.replace(/\.json$/, ''), file, score, snippet: bestSnippet, matchedTerms: [...matched] })
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Ringkasan manusiawi untuk hasil pencarian. */
export function formatHits(hits: SessionHit[]): string {
  if (hits.length === 0) return 'Tidak ada sesi lama yang cocok.'
  return hits
    .map((hit, index) => `${index + 1}. ${hit.sessionId} (skor ${hit.score}; term: ${hit.matchedTerms.join(', ')})\n   ${hit.snippet}`)
    .join('\n')
}

export function ensureSessionDir(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}
