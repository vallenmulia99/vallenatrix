const ANSI_PATTERN = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

export function splitMessage(text: string, limit = 4000): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('Message limit must be at least 2')
  const result: string[] = []
  let remaining = text

  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf('\n', limit - 1)
    if (splitAt >= Math.floor(limit * 0.5)) splitAt++
    else {
      splitAt = remaining.lastIndexOf(' ', limit - 1)
      if (splitAt >= Math.floor(limit * 0.5)) splitAt++
      else splitAt = limit
    }
    // Avoid splitting a UTF-16 surrogate pair.
    if (splitAt > 0 && splitAt < remaining.length &&
      /[\uD800-\uDBFF]/.test(remaining[splitAt - 1]) && /[\uDC00-\uDFFF]/.test(remaining[splitAt])) {
      splitAt--
    }
    result.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt)
  }
  if (remaining.length || result.length === 0) result.push(remaining)
  return result
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]!)
}

export function redact(text: string): string {
  return text.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***')
}
