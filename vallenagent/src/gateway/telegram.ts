import axios, { type AxiosInstance, type AxiosError } from 'axios'
import { chmodSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join, extname } from 'path'
import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import { logger } from '../logger'
import { redact, splitMessage } from './format'
import { gatewayDir, loadTelegramConfig, updateTelegramConfig, writeTelegramOffsetBeforeHandling } from './store'
import { SessionRouter, type RemoteTransport } from './router'
import type { GatewayAdapter, TelegramGatewayConfig } from './types'

interface TelegramUpdate {
  update_id: number
  message?: any
  callback_query?: any
}

interface TelegramMessageResult {
  message_id: number
}

class TelegramApiError extends Error {
  constructor(message: string, public status?: number, public retryAfter?: number) {
    super(message)
    this.name = 'TelegramApiError'
  }
}

export class TelegramAdapter implements GatewayAdapter, RemoteTransport {
  private running = false
  private fatalError: string | null = null
  private readonly router: SessionRouter
  private readonly api: AxiosInstance
  private readonly config: TelegramGatewayConfig
  private readonly pendingApprovals = new Map<string, { resolve: (approved: boolean) => void; userId: number; timer: ReturnType<typeof setTimeout> }>()
  private readonly rateLimits = new Map<number, { start: number; count: number; cooldownUntil: number }>()
  private readonly progressMessages = new Map<number, { messageId: number; editedAt: number; text: string }>()
  private readonly apiRoot: string
  private pollAbort: AbortController | null = null

  constructor(options: { apiRoot?: string; router?: SessionRouter } = {}) {
    this.config = loadTelegramConfig()
    if (!this.config.token) throw new Error('Telegram bot token belum diatur.')
    this.apiRoot = (options.apiRoot || 'https://api.telegram.org').replace(/\/$/, '')
    this.api = axios.create({ timeout: 65_000 })
    this.router = options.router || new SessionRouter()
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const me = await this.call<{ username?: string }>('getMe')
      this.config.bot_username = me.username
      this.config.last_error = undefined
      updateTelegramConfig({ bot_username: me.username, last_error: undefined })
      await this.call('deleteWebhook', { drop_pending_updates: false })
      void this.pollLoop()
    } catch (error) {
      this.running = false
      const message = this.safeError(error)
      this.config.last_error = message
      updateTelegramConfig({ last_error: message })
      throw new Error(message)
    }
  }

  async stop(): Promise<void> {
    this.running = false
    this.pollAbort?.abort()
    for (const pending of this.pendingApprovals.values()) {
      clearTimeout(pending.timer)
      pending.resolve(false)
    }
    this.pendingApprovals.clear()
  }

  async status(): Promise<Record<string, unknown>> {
    return { running: this.running, username: this.config.bot_username || null, allowed_users: this.config.allowlist.length, last_error: this.fatalError || this.config.last_error || null }
  }

  async send(chatId: number | string, rawText: string): Promise<void> {
    const text = rawText || '(empty response)'
    if (text.length > 12_000) {
      const form = new FormData()
      form.append('chat_id', String(chatId))
      form.append('document', new Blob([text], { type: 'text/plain' }), 'vallenatrix-response.txt')
      await this.request('sendDocument', form)
      return
    }
    for (const part of splitMessage(text, 4000)) {
      await this.call('sendMessage', { chat_id: chatId, text: part })
    }
  }

  async finish(chatId: number, text: string): Promise<void> {
    const previous = this.progressMessages.get(chatId)
    if (previous && text.length <= 4000) {
      await this.call('editMessageText', { chat_id: chatId, message_id: previous.messageId, text: text || 'Selesai.' })
      this.progressMessages.delete(chatId)
      return
    }
    if (previous) {
      try { await this.call('deleteMessage', { chat_id: chatId, message_id: previous.messageId }) } catch {}
      this.progressMessages.delete(chatId)
    }
    await this.send(chatId, text)
  }

  async typing(chatId: number): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action: 'typing' })
  }

  async progress(chatId: number, text: string): Promise<void> {
    const previous = this.progressMessages.get(chatId)
    if (!previous) {
      const message = await this.call<TelegramMessageResult>('sendMessage', { chat_id: chatId, text })
      this.progressMessages.set(chatId, { messageId: message.message_id, editedAt: Date.now(), text })
      return
    }
    if (text === previous.text || Date.now() - previous.editedAt < 2000) return
    await this.call('editMessageText', { chat_id: chatId, message_id: previous.messageId, text })
    previous.editedAt = Date.now()
    previous.text = text
  }

  async approve(chatId: number, userId: number, text: string): Promise<boolean> {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const answer = new Promise<boolean>(resolve => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(id)
        resolve(false)
      }, 120_000)
      this.pendingApprovals.set(id, { resolve, userId, timer })
    })
    try {
      await this.call('sendMessage', {
        chat_id: chatId,
        text: `Izin diperlukan (batas 2 menit):\n${text}`,
        reply_markup: { inline_keyboard: [[
          { text: 'Approve', callback_data: `approve:${id}` },
          { text: 'Deny', callback_data: `deny:${id}` }
        ]] }
      })
      return await answer
    } catch {
      const pending = this.pendingApprovals.get(id)
      if (pending) { clearTimeout(pending.timer); this.pendingApprovals.delete(id); pending.resolve(false) }
      return false
    }
  }

  private async pollLoop(): Promise<void> {
    let backoff = 1000
    while (this.running) {
      try {
        const updates = await this.call<TelegramUpdate[]>('getUpdates', {
          offset: this.config.last_update_id,
          timeout: 50,
          allowed_updates: JSON.stringify(['message', 'callback_query'])
        })
        backoff = 1000
        for (const update of updates) {
          // Persist the offset first: a crash must not re-execute a tool call on restart.
          writeTelegramOffsetBeforeHandling(update.update_id)
          this.config.last_update_id = update.update_id + 1
          Object.assign(this.config, loadTelegramConfig())
          if (update.callback_query) void this.handleCallback(update.callback_query).catch(error => logger.warn(`[Gateway] callback failed: ${this.safeError(error)}`))
          else if (update.message) void this.handleMessage(update.message).catch(error => logger.warn(`[Gateway] message handling failed: ${this.safeError(error)}`))
        }
      } catch (error) {
        if (!this.running) break
        const status = error instanceof TelegramApiError ? error.status : undefined
        const message = this.safeError(error)
        this.fatalError = message
        this.config.last_error = message
        updateTelegramConfig({ last_error: this.config.last_error })
        if (status === 409) {
          logger.error('[Gateway] Telegram polling conflict (409); another process is polling this bot. Stopping.')
          this.running = false
          break
        }
        if (status === 401) {
          logger.error('[Gateway] Telegram token rejected (401); daemon stopped.')
          this.running = false
          break
        }
        if (status === 429) {
          const retryAfter = Number(error instanceof TelegramApiError ? error.retryAfter || 1 : 1)
          await this.delay(Math.max(1, retryAfter) * 1000)
        } else {
          logger.warn(`[Gateway] Telegram network error: ${message}`)
          await this.delay(backoff)
          backoff = Math.min(30_000, backoff * 2)
        }
      }
    }
  }

  private async handleMessage(message: any): Promise<void> {
    const chat = message.chat
    const from = message.from
    if (!chat || chat.type !== 'private' || !from || !Number.isSafeInteger(from.id) || from.id <= 0 || Number(chat.id) !== Number(from.id)) {
      logger.info(`[Gateway] Ignored non-private Telegram chat ${String(chat?.id ?? 'unknown')}`)
      return
    }
    const userId = Number(from.id)
    const text = typeof message.text === 'string' ? message.text.trim() : typeof message.caption === 'string' ? message.caption.trim() : ''
    const image = this.getImageFile(message)
    if (!text && !image) return
    if (!this.checkRateLimit(userId)) return

    const config = loadTelegramConfig()
    if (!config.allowlist.includes(userId)) {
      const match = text.match(/^\/pair\s+(\d{6})$/)
      if (match) await this.tryPair(userId, match[1])
      return
    }
    if (text.startsWith('/pair')) return
    let imagePath: string | undefined
    if (image) {
      try { imagePath = await this.downloadImage(image.fileId, image.size) }
      catch (error) { await this.send(userId, `Gambar Telegram gagal diunduh: ${this.safeError(error)}`); return }
    }
    const accepted = this.router.enqueue(userId, text || 'Tolong analisis gambar ini.', this, imagePath)
    if (!accepted) {
      if (imagePath) { try { unlinkSync(imagePath) } catch {} }
      await this.send(userId, 'Antrean penuh (maksimal 3 pesan menunggu). Coba lagi sebentar lagi.')
    }
  }

  private getImageFile(message: any): { fileId: string; size?: number } | null {
    if (Array.isArray(message.photo) && message.photo.length) {
      const photo = [...message.photo].sort((a, b) => Number(b.file_size || 0) - Number(a.file_size || 0)).at(0)
      return photo?.file_id ? { fileId: String(photo.file_id), size: Number(photo.file_size) || undefined } : null
    }
    if (message.document?.file_id && String(message.document.mime_type || '').startsWith('image/')) {
      return { fileId: String(message.document.file_id), size: Number(message.document.file_size) || undefined }
    }
    return null
  }

  private async downloadImage(fileId: string, size?: number): Promise<string> {
    const maxBytes = 10 * 1024 * 1024
    if (size && size > maxBytes) throw new Error('Ukuran gambar melebihi batas 10 MB.')
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId })
    if (!file.file_path) throw new Error('Telegram tidak memberikan lokasi gambar.')
    if (file.file_size && file.file_size > maxBytes) throw new Error('Ukuran gambar melebihi batas 10 MB.')
    try {
      const response = await this.api.get(`${this.apiRoot}/file/bot${this.config.token}/${encodeURI(file.file_path)}`, {
        responseType: 'arraybuffer', timeout: 30_000
      })
      const buffer = Buffer.from(response.data)
      if (buffer.length > maxBytes) throw new Error('Ukuran gambar melebihi batas 10 MB.')
      const mime = String(response.headers['content-type'] || 'image/jpeg').split(';')[0]
      if (!mime.startsWith('image/')) throw new Error('File Telegram bukan gambar.')
      const ext = extname(file.file_path).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10) || '.img'
      const dir = join(gatewayDir(), 'telegram', 'media')
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      chmodSync(dir, 0o700)
      const path = join(dir, `${randomUUID()}${ext}`)
      writeFileSync(path, buffer, { mode: 0o600, flag: 'wx' })
      chmodSync(path, 0o600)
      return path
    } catch (error) {
      throw new Error(this.safeError(error))
    }
  }

  private async tryPair(userId: number, code: string): Promise<void> {
    const config = loadTelegramConfig()
    const pairing = config.pairing
    if (!pairing || Date.now() > pairing.expires_at) {
      config.pairing = undefined
      updateTelegramConfig(config)
      await this.send(userId, 'Kode pairing tidak ada atau sudah kedaluwarsa. Buat kode baru dari terminal.')
      return
    }
    const expected = Buffer.from(String(pairing.code_hash || ''), 'hex')
    const provided = createHash('sha256').update(String(code)).digest()
    const matches = expected.length === provided.length && timingSafeEqual(expected, provided)
    if (!matches) {
      pairing.attempts++
      if (pairing.attempts >= 5) config.pairing = undefined
      updateTelegramConfig(config)
      await this.send(userId, pairing.attempts >= 5 ? 'Kode pairing hangus setelah 5 percobaan.' : `Kode salah. Sisa percobaan: ${5 - pairing.attempts}.`)
      return
    }
    config.allowlist = [...new Set([...config.allowlist, userId])]
    config.pairing = undefined
    updateTelegramConfig(config)
    await this.send(userId, 'Telegram berhasil dipasangkan ke Vallenatrix. Kirim pesan untuk mulai.')
  }

  private async handleCallback(query: any): Promise<void> {
    const fromId = Number(query.from?.id)
    if (!this.config.allowlist.includes(fromId)) return
    const data = String(query.data || '').match(/^(approve|deny):([a-z0-9-]+)$/i)
    if (!data) return
    const pending = this.pendingApprovals.get(data[2])
    if (!pending || pending.userId !== fromId) return
    clearTimeout(pending.timer)
    this.pendingApprovals.delete(data[2])
    pending.resolve(data[1].toLowerCase() === 'approve')
    await this.call('answerCallbackQuery', { callback_query_id: query.id, text: 'Diterima.' })
  }

  private checkRateLimit(userId: number): boolean {
    const now = Date.now()
    if (this.rateLimits.size > 1000) {
      for (const [id, entry] of this.rateLimits) {
        if (now - entry.start > 120_000 && entry.cooldownUntil <= now) this.rateLimits.delete(id)
      }
      while (this.rateLimits.size > 1000) this.rateLimits.delete(this.rateLimits.keys().next().value!)
    }
    const value = this.rateLimits.get(userId) || { start: now, count: 0, cooldownUntil: 0 }
    if (value.cooldownUntil > now) return false
    if (now - value.start >= 60_000) { value.start = now; value.count = 0 }
    value.count++
    if (value.count > 20) {
      value.cooldownUntil = now + 60_000
      this.rateLimits.set(userId, value)
      return false
    }
    this.rateLimits.set(userId, value)
    return true
  }

  private async call<T = any>(method: string, payload?: Record<string, unknown>): Promise<T> {
    return this.request<T>(method, payload)
  }

  private async request<T = any>(method: string, payload?: Record<string, unknown> | FormData): Promise<T> {
    const pollController = method === 'getUpdates' ? new AbortController() : null
    if (pollController) this.pollAbort = pollController
    try {
      const response = await this.api.post(`${this.apiRoot}/bot${this.config.token}/${method}`, payload || {}, {
        timeout: method === 'getUpdates' ? 65_000 : 20_000,
        signal: pollController?.signal
      })
      if (!response.data?.ok) {
        throw new TelegramApiError(
          redact(String(response.data?.description || `Telegram ${method} failed`)),
          Number(response.data?.error_code) || undefined,
          Number(response.data?.parameters?.retry_after) || undefined
        )
      }
      return response.data.result as T
    } catch (error) {
      if (error instanceof TelegramApiError) throw error
      if (axios.isAxiosError(error)) {
        throw new TelegramApiError(
          this.safeError(error),
          error.response?.status,
          Number((error.response?.data as any)?.parameters?.retry_after) || undefined
        )
      }
      throw new TelegramApiError(this.safeError(error))
    } finally {
      if (pollController && this.pollAbort === pollController) this.pollAbort = null
    }
  }

  private safeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const ax = error as AxiosError
      const description = (ax.response?.data as any)?.description
      return redact(String(description || ax.message || 'Telegram request failed'))
    }
    return redact(error instanceof Error ? error.message : String(error))
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
