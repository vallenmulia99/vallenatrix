import type { AIAgent } from './agent'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  allowTelegramUser, createTelegramPairingCode, getTelegramBotInfo, revokeTelegramUser,
  sendTelegramNotification, setTelegramApproval, setTelegramToken, startTelegramGateway,
  stopTelegramGateway, restartTelegramGateway, telegramStatus
} from './gateway/manager'
import { loadTelegramConfig } from './gateway/store'

export interface CommandContext {
  channel: 'terminal' | 'remote'
  agent: AIAgent
  userId?: number
  sessionPrefix?: string
  busy?: boolean
}

export interface CommandResult {
  handled: boolean
  response: string
}

const NOT_HANDLED: CommandResult = { handled: false, response: '' }
const TERMINAL_ONLY = new Set(['/token', '/geteway', '/gateway', '/pty', '/sh'])

export async function handleCommand(ctx: CommandContext, text: string): Promise<CommandResult> {
  const [command = '', ...args] = text.trim().split(/\s+/)
  const cmd = command.toLowerCase()

  if (ctx.channel === 'remote' && TERMINAL_ONLY.has(cmd)) {
    return { handled: true, response: 'Command ini hanya bisa digunakan dari terminal Vallenatrix.' }
  }

  if (cmd === '/geteway' || cmd === '/gateway') {
    if (ctx.channel !== 'terminal') return { handled: true, response: 'Command ini hanya bisa digunakan dari terminal Vallenatrix.' }
    return { handled: true, response: await handleGatewayCommand(args) }
  }

  if (cmd === '/memory' && ctx.channel === 'terminal') {
    const { memoryStore } = ctx.agent
    const [action = 'list', ...rest] = args
    if (action === 'list') return { handled: true, response: memoryStore.formatForSystemPrompt() || 'Belum ada memori tersimpan.' }
    if (!['add', 'replace', 'remove'].includes(action)) {
      return { handled: true, response: 'Penggunaan: /memory [list|add|replace|remove] [project|user] <teks>. Replace: /memory replace [scope] <teks lama> => <teks baru>.' }
    }
    let scope = rest[0]
    if (scope !== 'project' && scope !== 'user') scope = 'project'
    else rest.shift()
    const target = scope === 'user' ? 'user' : 'memory'
    const text = rest.join(' ').trim()
    let result: Record<string, any>
    if (action === 'add') result = await memoryStore.add(target, text)
    else if (action === 'remove') result = await memoryStore.remove(target, text)
    else {
      const separator = text.indexOf(' => ')
      if (separator < 0) return { handled: true, response: 'Format replace: /memory replace [scope] <teks lama> => <teks baru>.' }
      result = await memoryStore.replace(target, text.slice(0, separator), text.slice(separator + 4))
    }
    if (!result.success) return { handled: true, response: `Memori gagal diubah: ${result.error || 'operasi gagal'}` }
    const verb = action === 'add' ? 'disimpan' : action === 'replace' ? 'diperbarui' : 'dihapus'
    return { handled: true, response: `Memori ${scope} ${verb}.` }
  }

  if (ctx.channel !== 'remote') return NOT_HANDLED
  const { agent, userId = 0, sessionPrefix = `tg-${userId}-` } = ctx

  if (cmd === '/stop') {
    return { handled: true, response: agent.interrupt() ? '⏹ Perintah berhenti dikirim ke agent.' : 'Tidak ada proses agent yang sedang berjalan.' }
  }
  if (cmd === '/status') {
    return { handled: true, response: ctx.busy ? 'Agent sedang mengerjakan pesan.' : `Agent siap. Model: ${agent.provider.model}` }
  }
  if (cmd === '/new' || cmd === '/reset') {
    agent.resetSession(`${sessionPrefix}${Date.now()}`)
    return { handled: true, response: 'Sesi baru dimulai.' }
  }
  if (cmd === '/model') {
    if (!args.length) return { handled: true, response: `Model saat ini: ${agent.provider.model}\nPakai /model <nama-model> untuk mengganti model di sesi ini.` }
    const model = args.join(' ').slice(0, 200)
    agent.setModel(model, false)
    return { handled: true, response: `Model sesi diubah ke ${model}.` }
  }
  if (cmd === '/sessions') {
    const sessions = agent.sessionManager.listSessions().filter(session => session.id.startsWith(sessionPrefix)).slice(0, 10)
    return { handled: true, response: sessions.length
      ? sessions.map(session => `${session.id} — ${session.title} (${session.updated_at})`).join('\n')
      : 'Belum ada sesi tersimpan.' }
  }
  if (cmd === '/resume') {
    const target = args[0]
    if (!target || !target.startsWith(sessionPrefix)) {
      return { handled: true, response: `Gunakan /resume <id> dari daftar /sessions milikmu (prefix ${sessionPrefix}).` }
    }
    return { handled: true, response: agent.resumeSession(target) ? `Sesi ${target} dilanjutkan.` : 'Sesi tidak ditemukan.' }
  }
  if (cmd === '/help') {
    return { handled: true, response: 'Perintah Telegram: /new, /resume <id>, /stop, /status, /model [nama], /plan [tugas], /sessions, /help.' }
  }
  if (cmd === '/plan') return NOT_HANDLED
  return NOT_HANDLED
}

async function handleGatewayCommand(args: string[]): Promise<string> {
  const [platform = '', action = '', ...rest] = args
  if (!platform) {
    const wa = existsWhatsAppClient() ? 'WA connector ditemukan' : 'WA connector lokal belum tersedia'
    const tg = telegramStatus()
    return `[Gateway]\nWhatsApp: ${wa}\nTelegram: ${tg.running ? `aktif (PID ${tg.pid})` : tg.configured ? 'siap, belum aktif' : 'token belum diatur'}\n\nPerintah: /geteway wa | /geteway tel <token|pair|start|stop|restart|status|allow|revoke|send|approval>`
  }
  if (platform === 'wa' || platform === 'whatsapp') {
    const actionArg = action.toLowerCase()
    if (!existsWhatsAppClient()) return 'WA gateway belum tersedia di source watools (wa-client.js tidak ditemukan).'
    return actionArg === 'status'
      ? 'WA client terpasang. Untuk operasi lainnya gunakan watools/wa-client.js sesuai setup lokal.'
      : 'WA client lokal terdeteksi, tetapi integrasi daemon WA belum ditautkan ke pengelola gateway ini.'
  }
  if (!['tel', 'telegram', 'tg'].includes(platform)) return 'Pilihan tidak dikenal. Gunakan /geteway wa atau /geteway tel.'

  const sub = action.toLowerCase()
  if (!sub || sub === 'status') {
    const status = telegramStatus()
    const config = loadTelegramConfig()
    let bot = config.bot_username || 'belum diverifikasi'
    if (config.token && !config.bot_username) {
      try { bot = await getTelegramBotInfo() } catch (error) { return `${statusText(status)}\n${safeError(error)}` }
    }
    return `${statusText(status)}\nBot: ${bot}`
  }
  if (sub === 'token') {
    if (!rest[0]) return 'Penggunaan: /geteway tel token <token dari @BotFather>'
    setTelegramToken(rest[0])
    return 'Token Telegram disimpan dengan permission 0600. Nilai token disembunyikan.'
  }
  if (sub === 'pair') {
    if (!loadTelegramConfig().token) return 'Atur token Telegram dulu: /geteway tel token <token>'
    const code = createTelegramPairingCode()
    return `Kode pairing: ${code}\nBerlaku 5 menit dan hanya bisa dipakai sekali. Kirim /pair ${code} ke bot Telegram secara pribadi.`
  }
  if (sub === 'start') return startTelegramGateway().message
  if (sub === 'stop') return stopTelegramGateway().message
  if (sub === 'restart') {
    return (await restartTelegramGateway()).message
  }
  if (sub === 'allow' || sub === 'revoke') {
    const userId = Number(rest[0])
    if (!Number.isSafeInteger(userId) || userId <= 0) return `Penggunaan: /geteway tel ${sub} <numeric-user-id>`
    const changed = sub === 'allow' ? allowTelegramUser(userId) : revokeTelegramUser(userId)
    return changed ? `User ${userId} ${sub === 'allow' ? 'ditambahkan ke' : 'dihapus dari'} allowlist.` : `User ${userId} tidak berubah.`
  }
  if (sub === 'send') {
    const message = rest.join(' ').trim()
    if (!message) return 'Penggunaan: /geteway tel send <teks notifikasi>'
    const sent = await sendTelegramNotification(message)
    return `Notifikasi terkirim ke ${sent} user Telegram.`
  }
  if (sub === 'approval') {
    try {
      const mode = setTelegramApproval(rest[0] || '')
      return `Mode approval Telegram: ${mode}.`
    }
    catch (error) { return safeError(error) }
  }
  return 'Penggunaan: /geteway tel token|pair|start|stop|restart|status|allow|revoke|send|approval'
}

function statusText(status: Record<string, unknown>): string {
  return `Telegram gateway: ${status.running ? `aktif (PID ${status.pid})` : 'mati'}\nUser terdaftar: ${status.allowed_users}\nApproval: ${status.approval}${status.last_error ? `\nError terakhir: ${status.last_error}` : ''}`
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***') : 'Operasi gateway gagal.'
}

function existsWhatsAppClient(): boolean {
  return existsSync(join(process.cwd(), 'watools', 'wa-client.js'))
}
