import type { Provider } from './providers'
import { summarizeBlocks, type SummarizeFn } from './compaction'

/**
 * Ringkasan lewat model, bukan cuma fungsi lokal.
 *
 * `compactHistory`/`compactActiveTurn` di agent.ts meringkas dengan aturan lokal:
 * cepat, gratis, tapi detail hilang. Fungsi di sini menambahkan jalur LLM: kirim
 * blok lama ke model (sebaiknya model murah) dan minta ringkasan faktual.
 *
 * Aturan penting: ringkasan TIDAK dijalankan kalau:
 * - provider/model tidak tersedia
 * - turn sedang dibatalkan
 * - keluaran model kosong atau gagal (pemanggil jatuh balik ke jalur lokal)
 *
 * Diadaptasi dari Hermes agent/context_compressor_summary.py.
 */

export interface SummarizerOptions {
  /** Provider untuk meringkas. Boleh berupa provider utama kalau tidak ada model murah. */
  provider: Provider
  /** Model untuk meringkas. Kosongkan = pakai model provider. */
  model?: string
  /** Batas output token per permintaan ringkasan. */
  maxOutputTokens?: number
}

const SYSTEM = 'You compress prior agent work into a factual handover note. Output only the note.'

export function createSummarizer(options: SummarizerOptions): SummarizeFn {
  const model = options.model || options.provider.model

  return async ({ content, maxChars, signal }) => {
    if (signal?.aborted) return null
    if (!content.trim()) return null

    const response = await options.provider.chat({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildPrompt(content, maxChars) }
      ],
      max_tokens: options.maxOutputTokens ?? 2000,
      temperature: 0,
      signal,
      timeout: 60_000
    })

    const text = response.choices?.[0]?.message?.content
    return typeof text === 'string' ? text : null
  }
}

export function buildPrompt(content: string, maxChars: number): string {
  return [
    'Compress the material below into a factual handover note for the agent that continues this work.',
    'Keep ONLY: the original goal, decisions made, files created or changed, commands run with their real results, and what is still unfinished.',
    'Do not invent anything, do not give advice, do not address the user.',
    `Write compact bullet lines. Maximum ${maxChars} characters.`,
    '',
    '--- MATERIAL ---',
    content
  ].join('\n')
}

/**
 * Ringkas satu blok dengan fallback: kalau LLM gagal, kembalikan null dan pemanggil
 * memakai ringkasan lokal.
 */
export async function summarizeWithProvider(
  summarizer: SummarizeFn,
  content: string,
  maxChars: number,
  signal?: AbortSignal
): Promise<string | null> {
  return summarizeBlocks(content, maxChars, summarizer, signal)
}

/**
 * Pilih provider model murah: pakai entri `providers.auxiliary` kalau ada,
 * kalau tidak pakai provider aktif.
 */
export function pickSummarizerProvider(
  activeProvider: Provider,
  createProvider: (name: string, baseURL: string, apiKey: string, model: string) => Provider,
  config?: { providers?: Record<string, any>; auxiliary?: { provider?: string; model?: string } }
): { provider: Provider; model?: string } {
  const aux = config?.auxiliary
  if (aux?.provider) {
    const entry = config?.providers?.[aux.provider]
    if (entry && typeof entry === 'object' && entry.base_url) {
      try {
        return {
          provider: createProvider(aux.provider, entry.base_url, entry.api_key || '', aux.model || entry.model),
          model: aux.model || entry.model
        }
      } catch {
        // Fall through to the active provider.
      }
    }
  }
  return { provider: activeProvider }
}
