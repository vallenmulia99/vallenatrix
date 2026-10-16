// Lightweight renderer-side markdown for the agent response box.
// The terminal prints literal characters: **, ` and # headers show up as noise,
// so strip the markers and keep the readable text with ANSI color instead.

const ESC = '\x1b['
const RESET = `${ESC}0m`

function style(text: string, code: string): string {
  return text ? `${code}${text}${RESET}` : ''
}

/** Strip inline markdown markers, applying color to emphasis and code spans. */
export function inlineMarkdown(line: string, baseColor: string, accent: string, cool: string): string {
  let output = line.replace(/`([^`]+)`/g, (_match, code) => style(code, cool))
  output = output.replace(/\*\*([^*]+)\*\*/g, (_match, bold) => style(bold, accent))
  output = output.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,:;!?]|$)/g, (_match, prefix, italic) => `${prefix}${style(italic, accent)}`)
  output = output.replace(/(^|[\s(])__([^_\n]+)__(?=[\s).,:;!?]|$)/g, (_match, prefix, bold) => `${prefix}${style(bold, accent)}`)
  output = output.replace(/^#{1,6}\s+/, '')
  output = output.replace(/^>\s?/, '')
  if (baseColor && !output.includes(ESC)) output = style(output, baseColor)
  return output
}

/**
 * Render an agent response for the terminal: markdown markers removed, headers and
 * bullets colored, and table pipes aligned into readable columns.
 */
export function renderMarkdownForTerminal(text: string, baseColor: string, accentColor: string, coolColor: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const output: string[] = []
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (!trimmed) { output.push(''); continue }
    // Drop a markdown table separator row (|---|---|).
    if (/^\|?[\s:|-]+\|[\s:|-]*$/.test(trimmed) && trimmed.includes('-')) continue
    if (trimmed.startsWith('|')) {
      const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
      const rendered = cells.map(cell => inlineMarkdown(cell, baseColor, accentColor, coolColor))
      output.push(`${style('│ ', coolColor)}${rendered.join(` ${style('│', coolColor)} `)}`)
      continue
    }
    const bullet = trimmed.match(/^[-*+]\s+(.*)$/)
    if (bullet) {
      output.push(`${style('•', accentColor)} ${inlineMarkdown(bullet[1], baseColor, accentColor, coolColor)}`)
      continue
    }
    const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/)
    if (numbered) {
      output.push(`${style(`${numbered[1]}.`, accentColor)} ${inlineMarkdown(numbered[2], baseColor, accentColor, coolColor)}`)
      continue
    }
    const header = trimmed.match(/^#{1,6}\s+(.*)$/)
    if (header) {
      output.push(style(inlineMarkdown(header[1], '', accentColor, coolColor).replace(/\x1b\[0m/g, ''), accentColor))
      continue
    }
    output.push(inlineMarkdown(line, baseColor, accentColor, coolColor))
  }
  while (output.length && output[output.length - 1] === '') output.pop()
  return output
}
