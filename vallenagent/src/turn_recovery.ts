import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Turn recovery — bikin turn panjang bisa lanjut setelah error provider di tengah jalan.
 *
 * Masalah yang diperbaiki: satu error transport/500/timeout di iterasi ke-40 mematikan
 * seluruh turn, dan kerja 40 iterasi itu hilang dari pandangan user. Di sini progres
 * ditulis ke disk sebelum error dilempar, dan pemanggil bisa membangun prompt resume.
 *
 * Diadaptasi dari Hermes agent/turn_recovery.py — versi minimal: hanya menyimpan,
 * membaca, dan menyusun prompt lanjutan. Tidak ada auto-retry di dalam modul ini.
 */

export interface TurnCheckpoint {
  sessionId: string
  updatedAt: number
  iterations: number
  toolCalls: number
  /** Permintaan user yang sedang dikerjakan. */
  userRequest: string
  /** Nama file yang sudah tersentuh di turn ini. */
  filesTouched: string[]
  /** Ringkasan langkah terakhir (bukan seluruh history). */
  progress: string
  /** Pesan error terakhir yang membuat turn berhenti. */
  lastError?: string
}

const MAX_PROGRESS_CHARS = 4000
const MAX_FILES = 60

export function checkpointPath(dir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  return join(dir, `turn-${safe}.json`)
}

export function buildCheckpoint(input: {
  sessionId: string
  iterations: number
  toolCalls: number
  userRequest: string
  filesTouched?: Iterable<string>
  progress: string
  lastError?: string
}): TurnCheckpoint {
  const progress = String(input.progress || '').replace(/\s+\n/g, '\n').trim()
  return {
    sessionId: input.sessionId,
    updatedAt: Date.now(),
    iterations: input.iterations,
    toolCalls: input.toolCalls,
    userRequest: String(input.userRequest || '').slice(0, 4000),
    filesTouched: [...(input.filesTouched ?? [])].slice(-MAX_FILES),
    progress: progress.length > MAX_PROGRESS_CHARS ? `${progress.slice(0, MAX_PROGRESS_CHARS - 1)}…` : progress,
    lastError: input.lastError ? String(input.lastError).slice(0, 1000) : undefined
  }
}

export function saveCheckpoint(dir: string, checkpoint: TurnCheckpoint): string | null {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = checkpointPath(dir, checkpoint.sessionId)
    writeFileSync(file, JSON.stringify(checkpoint, null, 2), { mode: 0o600 })
    return file
  } catch {
    // Checkpoint bersifat bantu; gagal tulis tidak boleh menutupi error asli.
    return null
  }
}

export function loadCheckpoint(dir: string, sessionId: string): TurnCheckpoint | null {
  const file = checkpointPath(dir, sessionId)
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    if (!raw || typeof raw !== 'object' || typeof raw.userRequest !== 'string') return null
    return {
      sessionId: String(raw.sessionId || sessionId),
      updatedAt: Number(raw.updatedAt) || 0,
      iterations: Number(raw.iterations) || 0,
      toolCalls: Number(raw.toolCalls) || 0,
      userRequest: raw.userRequest,
      filesTouched: Array.isArray(raw.filesTouched) ? raw.filesTouched.map(String).slice(-MAX_FILES) : [],
      progress: String(raw.progress || ''),
      lastError: typeof raw.lastError === 'string' ? raw.lastError : undefined
    }
  } catch {
    return null
  }
}

/** Prompt lanjutan untuk dikirim sebagai pesan user setelah turn gagal di tengah. */
export function buildResumePrompt(checkpoint: TurnCheckpoint): string {
  const lines = [
    '[Resumed turn]',
    `The previous attempt stopped after ${checkpoint.iterations} iterations with an error, not because the work was finished.`,
    checkpoint.lastError ? `Error: ${checkpoint.lastError}` : '',
    '',
    'Original request:',
    checkpoint.userRequest,
    '',
    checkpoint.filesTouched.length ? `Files already touched: ${checkpoint.filesTouched.join(', ')}` : '',
    checkpoint.progress ? 'Progress so far:' : '',
    checkpoint.progress,
    '',
    'Continue from this state. Do not repeat completed steps and do not re-apply the changes already listed. Finish the remaining work and verify it.'
  ]
  return lines.filter(line => line !== '').join('\n')
}

export function isCheckpointRelevant(checkpoint: TurnCheckpoint | null, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  if (!checkpoint) return false
  return Date.now() - checkpoint.updatedAt <= maxAgeMs
}

/** Hapus checkpoint setelah turn benar-benar selesai. */
export function clearCheckpoint(dir: string, sessionId: string): void {
  try {
    const file = checkpointPath(dir, sessionId)
    if (existsSync(file)) writeFileSync(file, '{}', { mode: 0o600 })
  } catch {
    // ignore
  }
}

export function progressFromHistory(messages: Array<{ role?: string; content?: string; name?: string }>, maxLines = 25): string {
  const lines: string[] = []
  for (const message of messages.slice(-80)) {
    if (message.role === 'assistant' && message.content) {
      lines.push(`Agent: ${String(message.content).replace(/\s+/g, ' ').slice(0, 300)}`)
    } else if (message.role === 'tool' && message.name) {
      lines.push(`Tool ${message.name}: ${String(message.content || '').replace(/\s+/g, ' ').slice(0, 200)}`)
    }
    if (lines.length > maxLines) lines.splice(0, lines.length - maxLines)
  }
  return lines.join('\n')
}

export function ensureCheckpointDir(base: string): string {
  mkdirSync(base, { recursive: true, mode: 0o700 })
  return base
}

export function defaultCheckpointDir(sessionDir?: string, home?: string): string {
  if (sessionDir) return dirname(join(sessionDir, 'x'))
  const base = home || process.env.VALLENATRIX_HOME || join(process.env.HOME || '.', '.vallenatrix')
  return join(base, 'sessions')
}
