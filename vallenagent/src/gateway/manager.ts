import axios from 'axios'
import { chmodSync, closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { createHash, randomInt } from 'crypto'
import { logger } from '../logger'
import { loadConfig, saveConfig } from '../config'
import { gatewayDir, loadTelegramConfig, saveTelegramConfig, updateTelegramConfig } from './store'
import { redact } from './format'
import type { TelegramApprovalMode } from './types'

const PID_FILE = () => join(gatewayDir(), 'telegram.pid')
const LOG_FILE = () => join(gatewayDir(), 'telegram.log')

function readPid(): number | null {
  try {
    const pid = Number(readFileSync(PID_FILE(), 'utf8').trim())
    return Number.isSafeInteger(pid) && pid > 1 ? pid : null
  } catch { return null }
}

function isRunning(pid = readPid()): pid is number {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    if (process.platform === 'linux') {
      const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      return command.includes('gateway/daemon.js')
    }
    return true
  } catch { return false }
}

export function createTelegramPairingCode(now = Date.now()): string {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const config = loadTelegramConfig()
  // Only the hash is persisted; the plaintext code exists solely in the terminal reply.
  config.pairing = { code_hash: createHash('sha256').update(code).digest('hex'), expires_at: now + 5 * 60_000, attempts: 0 }
  saveTelegramConfig(config)
  return code
}

export function setTelegramToken(token: string): void {
  const normalized = token.trim()
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(normalized)) {
    throw new Error('Format token Telegram tidak valid. Ambil token dari @BotFather.')
  }
  updateTelegramConfig({ token: normalized, last_error: undefined })
}

export function setTelegramApproval(mode: string): TelegramApprovalMode {
  if (mode !== 'dangerous' && mode !== 'all' && mode !== 'off') {
    throw new Error('Mode approval harus dangerous, all, atau off.')
  }
  updateTelegramConfig({ approval: mode })
  const config = loadConfig()
  saveConfig({ gateway: { ...config.gateway, telegram: { ...config.gateway?.telegram, approval: mode } } })
  return mode
}

export function allowTelegramUser(userId: number): boolean {
  if (!Number.isSafeInteger(userId) || userId <= 0) return false
  const config = loadTelegramConfig()
  if (config.allowlist.includes(userId)) return false
  config.allowlist.push(userId)
  saveTelegramConfig(config)
  return true
}

export function revokeTelegramUser(userId: number): boolean {
  const config = loadTelegramConfig()
  const before = config.allowlist.length
  config.allowlist = config.allowlist.filter(id => id !== userId)
  if (config.allowlist.length === before) return false
  saveTelegramConfig(config)
  return true
}

export function telegramStatus(): Record<string, unknown> {
  const config = loadTelegramConfig()
  const pid = readPid()
  const running = isRunning(pid)
  if (pid && !running) {
    try { unlinkSync(PID_FILE()) } catch {}
  }
  return {
    running,
    pid: running ? pid : null,
    bot_username: config.bot_username || null,
    allowed_users: config.allowlist.length,
    approval: config.approval,
    last_error: config.last_error || null,
    configured: Boolean(config.token)
  }
}

export function startTelegramGateway(): { started: boolean; pid?: number; message: string } {
  const config = loadTelegramConfig()
  if (!config.token) return { started: false, message: 'Atur token dulu: /geteway tel token <token>' }
  const pid = readPid()
  if (isRunning(pid)) return { started: false, pid: pid!, message: `Telegram gateway sudah aktif (PID ${pid}).` }

  const logFd = openSync(LOG_FILE(), 'a', 0o600)
  let child
  try {
    child = spawn(process.execPath, [join(__dirname, 'daemon.js')], {
      cwd: gatewayDir(), detached: true, stdio: ['ignore', logFd, logFd],
      env: { ...process.env, VALLENATRIX_GATEWAY: 'telegram' }
    })
  } finally { closeSync(logFd) }
  child.unref()
  if (!child.pid) return { started: false, message: 'Gagal menjalankan Telegram gateway.' }
  writeFileSync(PID_FILE(), String(child.pid), { encoding: 'utf8', mode: 0o600 })
  chmodSync(PID_FILE(), 0o600)
  logger.info(`[Gateway] Telegram daemon started (PID ${child.pid})`)
  return { started: true, pid: child.pid, message: `Telegram gateway dijalankan (PID ${child.pid}). Cek dengan /geteway tel status.` }
}

export function stopTelegramGateway(): { stopped: boolean; message: string } {
  const pid = readPid()
  if (!isRunning(pid)) {
    if (pid) { try { unlinkSync(PID_FILE()) } catch {} }
    return { stopped: false, message: 'Telegram gateway sedang mati.' }
  }
  try {
    process.kill(pid!, 'SIGTERM')
    return { stopped: true, message: `Telegram gateway dihentikan (PID ${pid}).` }
  } catch (error) {
    return { stopped: false, message: `Gagal menghentikan gateway: ${redact(error instanceof Error ? error.message : String(error))}` }
  }
}

export async function restartTelegramGateway(): Promise<{ started: boolean; pid?: number; message: string }> {
  const previousPid = readPid()
  if (isRunning(previousPid)) {
    stopTelegramGateway()
    for (let attempt = 0; attempt < 40 && isRunning(previousPid); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (isRunning(previousPid)) return { started: false, message: 'Gateway lama belum berhenti; coba lagi setelah beberapa detik.' }
  }
  return startTelegramGateway()
}

export async function sendTelegramNotification(text: string): Promise<number> {
  const config = loadTelegramConfig()
  if (!config.token) throw new Error('Token Telegram belum diatur.')
  if (!config.allowlist.length) throw new Error('Belum ada user Telegram yang dipasangkan.')
  let sent = 0
  for (const chatId of config.allowlist) {
    try {
      await axios.post(`https://api.telegram.org/bot${config.token}/sendMessage`, {
        chat_id: chatId, text
      }, { timeout: 20_000 })
      sent++
    } catch (error) {
      throw new Error(redact(`Gagal mengirim notifikasi Telegram: ${axios.isAxiosError(error) ? error.message : String(error)}`))
    }
  }
  return sent
}

export async function getTelegramBotInfo(token?: string): Promise<string> {
  const actualToken = token || loadTelegramConfig().token
  if (!actualToken) return 'Token belum diatur.'
  try {
    const response = await axios.get(`https://api.telegram.org/bot${actualToken}/getMe`, { timeout: 10_000 })
    return response.data?.result?.username ? `@${response.data.result.username}` : 'Bot terverifikasi.'
  } catch (error) {
    throw new Error(redact(`Token Telegram tidak bisa diverifikasi: ${axios.isAxiosError(error) ? error.message : String(error)}`))
  }
}

export class GatewayManager {
  start(platform: 'telegram' | 'wa'): { started: boolean; pid?: number; message: string } {
    if (platform === 'telegram') return startTelegramGateway()
    return { started: false, message: 'WhatsApp adapter belum tersedia di gateway manager ini.' }
  }

  stop(platform: 'telegram' | 'wa'): { stopped: boolean; message: string } {
    if (platform === 'telegram') return stopTelegramGateway()
    return { stopped: false, message: 'WhatsApp adapter belum tersedia di gateway manager ini.' }
  }

  status(): { telegram: Record<string, unknown>; whatsapp: { available: boolean } } {
    return {
      telegram: telegramStatus(),
      whatsapp: { available: false }
    }
  }
}
