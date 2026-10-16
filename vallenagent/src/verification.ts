import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Verification ledger — catatan bukti nyata bahwa agent benar-benar memverifikasi
 * pekerjaannya (command + hasil), bukan cuma mengaku selesai.
 *
 * Sengaja pasif: tidak pernah menjalankan test sendiri, tidak memblokir turn.
 * Dipakai untuk (a) menyuntik ringkasan bukti ke prompt dan (b) mendorong agent
 * sekali saja kalau belum ada bukti. Diadaptasi dari Hermes
 * agent/verification_evidence.py.
 */

export interface VerificationEntry {
  at: number
  command: string
  exitCode: number | null
  ok: boolean
  summary: string
}

const MAX_ENTRIES = 60
const SUMMARY_CHARS = 400

/** Command yang dianggap bukti verifikasi (jalanin test/build/lint/typecheck). */
const VERIFY_PATTERN = /\b(?:npm|pnpm|yarn|bun)\b[^\n;&|]*(?:test|lint|typecheck|check|build|tsc)|node\s+--test|pytest|vitest|jest|cargo\s+(?:test|check)|go\s+test|tsc\b|eslint\b|shellcheck\b|ruff\b|mypy\b/i

/** Command yang cuma membaca, bukan bukti. */
const READ_ONLY_PATTERN = /^\s*(?:cat|ls|pwd|echo|head|tail|wc|find|grep|rg|which|type|date|git\s+(?:status|diff|log|branch|show))\b/i

export function isVerificationCommand(command: string): boolean {
  const cmd = String(command || '').trim()
  if (!cmd) return false
  if (READ_ONLY_PATTERN.test(cmd)) return false
  return VERIFY_PATTERN.test(cmd)
}

function summarizeOutput(output: string): string {
  const flat = String(output || '').replace(/\s+/g, ' ').trim()
  return flat.length > SUMMARY_CHARS ? `${flat.slice(0, SUMMARY_CHARS)}…` : flat
}

/** Ekstrak hasil test yang umum supaya ringkasannya bermakna. */
function extractCounts(output: string): string {
  const text = String(output || '')
  const tests = /#\s*tests\s+(\d+)/.exec(text)
  const pass = /#\s*pass\s+(\d+)/.exec(text)
  const fail = /#\s*fail\s+(\d+)/.exec(text)
  if (tests && pass && fail) return `${pass[1]}/${tests[1]} pass, ${fail[1]} fail`
  const vitest = /Tests\s+(\d+)\s+passed/.exec(text)
  if (vitest) return `${vitest[1]} passed`
  const mocha = /(\d+)\s+passing/.exec(text)
  if (mocha) return `${mocha[1]} passing`
  return ''
}

export class VerificationLedger {
  private entries: VerificationEntry[] = []
  private nudged = false
  private turnStart = 0

  constructor(private readonly sessionId: string, private readonly dir?: string) {
    this.load()
  }

  private file(): string | null {
    return this.dir ? join(this.dir, `verification-${createHash('sha256').update(this.sessionId).digest('hex').slice(0, 16)}.json`) : null
  }

  private load(): void {
    const file = this.file()
    if (!file || !existsSync(file)) return
    try {
      const raw = JSON.parse(readFileSync(file, 'utf-8'))
      if (Array.isArray(raw)) {
        this.entries = raw.filter((e: any) => e && typeof e.command === 'string').slice(-MAX_ENTRIES)
      }
    } catch {
      this.entries = []
    }
  }

  private persist(): void {
    const file = this.file()
    if (!file) return
    try {
      mkdirSync(this.dir!, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(this.entries.slice(-MAX_ENTRIES)), { mode: 0o600 })
      renameSync(tmp, file)
    } catch {
      // Ledger bersifat bantu; gagal tulis tidak boleh mengganggu turn.
    }
  }

  /** Catat satu eksekusi terminal kalau itu command verifikasi. */
  record(command: string, exitCode: number | null, output: string): void {
    if (!isVerificationCommand(command)) return
    const counts = extractCounts(output)
    const ok = exitCode === 0
    this.entries.push({
      at: Date.now(),
      command: String(command).trim().slice(0, 300),
      exitCode,
      ok,
      summary: counts || summarizeOutput(output)
    })
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES)
    this.persist()
  }

  /** Ringkasan bukti untuk disuntik ke prompt; null kalau belum ada. */
  formatForInjection(): string | null {
    if (this.entries.length === 0) return null
    const last = this.entries[this.entries.length - 1]
    const okCount = this.entries.filter(e => e.ok).length
    const failCount = this.entries.length - okCount
    const lines = [
      '[Verification Evidence]',
      `${this.entries.length} perintah verifikasi tercatat (${okCount} sukses, ${failCount} gagal).`,
      `Terakhir: ${last.ok ? 'OK' : 'GAGAL'} — ${last.command}${last.summary ? ` → ${last.summary}` : ''}`,
      'Sebutkan bukti ini di laporan akhir. Jangan klaim "selesai" untuk pekerjaan yang belum dijalankan.'
    ]
    if (failCount > 0 && !last.ok) {
      lines.push('Perintah verifikasi terakhir GAGAL: perbaiki dulu sebelum menyatakan selesai.')
    }
    return lines.join('\n')
  }

  /** true = sudah waktunya mendorong agent sekali untuk verifikasi. */
  shouldNudge(hadEdits: boolean, requireTypecheck = false, typecheckVerified = false): boolean {
    const hasEvidence = this.entries.slice(this.turnStart).length > 0
    if (this.nudged || !hadEdits || (requireTypecheck ? typecheckVerified : hasEvidence)) return false
    this.nudged = true
    return true
  }

  beginTurn(): void {
    this.nudged = false
    this.turnStart = this.entries.length
  }

  markWorkspaceEdited(): void {
    this.turnStart = this.entries.length
  }

  get count(): number {
    return this.entries.length
  }

  get entriesSnapshot(): VerificationEntry[] {
    return this.entries.map(e => ({ ...e }))
  }
}
