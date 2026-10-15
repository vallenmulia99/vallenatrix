import type { Message } from './providers'

/**
 * Ringkasan berjenjang (hierarchical compaction).
 *
 * `buildSummaryLines` di agent.ts meringkas tanpa LLM: cepat dan murah, tapi detail
 * hilang — agent "lupa" langkah lama dan mengulang pekerjaan. Modul ini menambahkan
 * jalur LLM opsional: ringkasan lama digabung jadi satu ringkasan baru yang lebih
 * padat, sekali per kompaksi, memakai model murah lewat `summarize` yang disuntikkan
 * pemanggil (biasanya auxiliary provider).
 *
 * Kalau `summarize` tidak tersedia atau gagal, pemanggil tetap pakai jalur lokal —
 * jadi perilaku lama dipertahankan.
 */

export const HIERARCHICAL_HEADER = '[Summary of earlier work'

export interface SummarizeRequest {
  /** Teks ringkasan/blok lama yang akan dipadatkan. */
  content: string
  /** Batas karakter hasil ringkasan. */
  maxChars: number
  /** Sinyal abort turn supaya ringkasan ikut berhenti kalau user menekan stop. */
  signal?: AbortSignal
}

export type SummarizeFn = (request: SummarizeRequest) => Promise<string | null>

/** Prompt ringkas: instruksi ketat supaya hasilnya padat dan tidak berhalusinasi. */
export function buildSummarizePrompt(content: string, maxChars: number): string {
  return [
    'You compress prior agent work into a factual handover note.',
    'Keep ONLY: the original goal, decisions made, files created or changed, commands run with their real results, and what is still unfinished.',
    'Do not invent anything. Do not add advice. Do not address the user.',
    'Write compact bullet lines. Maximum ' + maxChars + ' characters.',
    '',
    '--- MATERIAL TO COMPRESS ---',
    content
  ].join('\n')
}

/** Bersihkan keluaran model: buang pagar kode dan rapikan ke batas karakter. */
export function normalizeSummary(raw: string, maxChars: number): string | null {
  const text = String(raw || '')
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  if (!text) return null
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

/**
 * Gabungkan blok ringkasan lama menjadi satu ringkasan baru.
 * `content` biasanya gabungan dari `SUMMARY_HEADER` lama; hasilnya satu blok.
 */
export async function summarizeBlocks(content: string, maxChars: number, summarize: SummarizeFn, signal?: AbortSignal): Promise<string | null> {
  try {
    const raw = await summarize({ content, maxChars, signal })
    if (raw == null) return null
    return normalizeSummary(raw, maxChars)
  } catch {
    return null
  }
}

/** Apakah pesan ini blok ringkasan (dari jalur lokal maupun LLM)? */
export function isSummaryBlock(message: Message): boolean {
  if (message.role !== 'user') return false
  const content = String(message.content || '')
  return content.startsWith('[Summary of earlier work') || content.startsWith('[Context summary')
}

/** Berapa blok ringkasan yang sudah ada di history. */
export function countSummaryBlocks(history: Message[]): number {
  return history.filter(isSummaryBlock).length
}

/**
 * Gabungkan beberapa blok ringkasan berurutan menjadi satu string input untuk LLM.
 * Dipakai saat history sudah punya >1 blok ringkasan (gejala kompaksi berulang).
 */
export function mergeSummaryInputs(history: Message[]): string {
  return history
    .filter(isSummaryBlock)
    .map(m => String(m.content))
    .join('\n')
}
