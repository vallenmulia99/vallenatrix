export interface SavedPasteReference {
  path: string
  lines: number
  characters: number
}

export const PASTE_INLINE_MAX_CHARS = 2_000
export const PASTE_INLINE_MAX_LINES = 20

export function normalizePrompt(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')
}

export function shouldOffloadPaste(text: string): boolean {
  return text.length > PASTE_INLINE_MAX_CHARS || text.split(/\r\n|\r|\n/).length > PASTE_INLINE_MAX_LINES
}

export function buildPromptForAgent(text: string, pastes: SavedPasteReference[]): string {
  const message = normalizePrompt(text)
  if (pastes.length === 0) return message

  const references = pastes.map((paste) =>
    `- ${paste.path} (${paste.lines} lines, ${paste.characters} characters)`
  ).join('\n')
  const request = message ? `User request:\n${message}` : 'User asks you to inspect the pasted source.'
  return `${request}\n\nPasted source files (saved verbatim; do not infer unseen content):\n${references}\nRead each complete file with read_file before analyzing or editing it.`
}
