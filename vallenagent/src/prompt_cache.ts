import type { Message } from './providers'

/**
 * Prompt-cache marker untuk provider yang mendukungnya (Anthropic-style
 * `cache_control`, OpenRouter-style `cache_control`, dan gateway yang meneruskan
 * field ini apa adanya).
 *
 * Latar: system prompt + schema tool + index skill itu blok besar yang identik
 * setiap iterasi. Tanpa marker, provider menghitungnya ulang sebagai input baru
 * setiap request — biaya naik dan konteks efektif menyusut. Dengan marker, provider
 * menyimpan prefix itu dan hanya menghitung bagian baru.
 *
 * Prinsip: hanya menandai prefix STABIL (system prompt + rangkaian pesan paling awal).
 * Bagian yang berubah (pesan user terakhir, hasil tool) tidak boleh masuk cache,
 * karena satu byte berubah = seluruh cache di belakangnya batal.
 */

export interface CacheMarkerOptions {
  /** Jumlah pesan dari awal history yang dianggap stabil. Default: 1 (hanya system prompt). */
  prefixMessages?: number
  /** Nama model, untuk menyalakan aturan per-provider. */
  model?: string
}

/** Provider yang menerima `cache_control` pada message content block. */
const CACHE_CAPABLE = /claude|anthropic|gemini|openrouter|bedrock|vertex/i

export function supportsPromptCache(model: string | undefined, baseURL?: string): boolean {
  if (process.env.VALLENATRIX_PROMPT_CACHE === 'off') return false
  const target = `${model || ''} ${baseURL || ''}`
  return CACHE_CAPABLE.test(target)
}

/**
 * Tandai pesan prefix dengan `cache_control`.
 * Pesan yang tidak bisa ditandai (role tool / content non-string) dilewati apa adanya,
 * jadi fungsi ini selalu aman dipanggil.
 */
export function markCachePrefix<T extends Message>(messages: T[], options: CacheMarkerOptions = {}): T[] {
  const prefixCount = Math.max(1, Math.min(options.prefixMessages ?? 1, messages.length))
  if (messages.length === 0) return messages

  return messages.map((message, index) => {
    if (index >= prefixCount) return message
    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') return message
    if (typeof message.content !== 'string' || message.content.length === 0) return message
    return { ...message, cache_control: { type: 'ephemeral' } } as T
  })
}

/**
 * Untuk endpoint yang menolak field tak dikenal, buang `cache_control` dari payload.
 * Dipakai sebagai fallback setelah provider menjawab 400 pada permintaan ber-cache.
 */
export function stripCacheMarkers<T extends Message>(messages: T[]): T[] {
  return messages.map(message => {
    if (!('cache_control' in (message as Record<string, unknown>))) return message
    const clone = { ...(message as Record<string, unknown>) }
    delete clone.cache_control
    return clone as unknown as T
  })
}

export function hasCacheMarkers(messages: Array<Record<string, unknown>>): boolean {
  return messages.some(message => 'cache_control' in message)
}
