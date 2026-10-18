import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, lstatSync, realpathSync, openSync, readSync, closeSync, renameSync, chmodSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs'
import { createHash } from 'crypto'
import { resolve, join, dirname, relative, isAbsolute, sep, basename } from 'path'
import { spawn } from 'child_process'
import { homedir, tmpdir } from 'os'
import { isIP, isIPv4, isIPv6 } from 'net'
import dns from 'dns'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { getVallenatrixHome, loadConfig, getActiveProvider } from './config'
import { validateSkillName, validateCategory } from './skills_hub_models'
import { registry, ToolContext, ToolSchema } from './tools'
import { SkillLoader } from './skills'
import { MemoryStore } from './memory'
import { TodoStore } from './todo'
import { searchSessions, formatHits } from './session_search'
import { manageProcess, startBackgroundProcess } from './process_manager'
import { captureTypeScriptDiagnostics, newTypeScriptDiagnostics } from './typescript_diagnostics'

function expandIpv6(ip: string): string[] {
  const parts = ip.split('::')
  const left = parts[0] ? parts[0].split(':') : []
  const right = parts[1] ? parts[1].split(':') : []
  const missing = 8 - (left.length + right.length)
  const mid = Array(Math.max(0, missing)).fill('0')
  return [...left, ...mid, ...right].map(g => g.padStart(4, '0'))
}

export function isPrivateAddress(ip: string): boolean {
  if (isIPv4(ip)) {
    const parts = ip.split('.').map(Number)
    if (parts[0] === 0) return true // 0.0.0.0/8
    if (parts[0] === 10) return true // 10.0.0.0/8
    if (parts[0] === 127) return true // 127.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true // 169.254.0.0/16
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true // 192.168.0.0/16
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true // 100.64.0.0/10
    if (parts[0] === 192 && parts[1] === 0) return true // IETF protocol assignments
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true // benchmarking
    if (parts[0] >= 224) return true // multicast and reserved
    return false
  }
  if (isIPv6(ip)) {
    const clean = ip.toLowerCase().replace(/^\[|\]$/g, '')
    if (clean === '::' || clean === '::1') return true

    // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1
    const mappedMatch = clean.match(/^::ffff:([0-9a-f.:]+)$/)
    if (mappedMatch) {
      const rest = mappedMatch[1]
      if (isIPv4(rest)) {
        return isPrivateAddress(rest)
      }
      const hexParts = rest.split(':')
      if (hexParts.length === 2) {
        const p1 = parseInt(hexParts[0], 16)
        const p2 = parseInt(hexParts[1], 16)
        if (!isNaN(p1) && !isNaN(p2)) {
          const ipv4Str = `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`
          return isPrivateAddress(ipv4Str)
        }
      }
    }

    const full = expandIpv6(clean)
    if (full.length === 8) {
      const firstWord = parseInt(full[0], 16)
      if (!isNaN(firstWord)) {
        // Block non-global IPv6 ranges.
        if ((firstWord & 0xffc0) === 0xfe80) return true

        if ((firstWord & 0xfe00) === 0xfc00) return true // ULA fc00::/7
        if ((firstWord & 0xff00) === 0xff00) return true // multicast ff00::/8
        if ((firstWord & 0xe000) !== 0x2000) return true // non-global unicast/reserved
      }
    }
  }
  return false
}

async function resolveSafeUrl(urlStr: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const url = new URL(urlStr)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol: only HTTP and HTTPS allowed')
  const rawHost = url.hostname
  const cleanHost = rawHost.replace(/^\[|\]$/g, '')
  if (rawHost === 'localhost' || rawHost.endsWith('.localhost')) throw new Error('Private IP addresses blocked (SSRF protection)')

  if (isIP(cleanHost)) {
    if (isPrivateAddress(cleanHost)) throw new Error('Private IP addresses blocked (SSRF protection)')
    return { url, address: cleanHost, family: isIP(cleanHost) as 4 | 6 }
  }

  try {
    const addresses = await dns.promises.lookup(rawHost, { all: true, verbatim: true })
    if (!addresses.length) throw new Error('No address records')
    for (const addr of addresses) {
      if (isPrivateAddress(addr.address)) throw new Error('Private IP addresses blocked (SSRF protection)')
    }
    const chosen = addresses[0]
    return { url, address: chosen.address, family: chosen.family as 4 | 6 }
  } catch (err: any) {
    if (err.message?.includes('Private IP addresses blocked')) throw err
    throw new Error(`Unable to validate host address: ${rawHost}`)
  }
}

export async function validateSafeUrl(urlStr: string): Promise<URL> {
  return (await resolveSafeUrl(urlStr)).url
}

type SafeRequestOptions = {
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
  requester?: (url: URL, options: any, callback: (response: any) => void) => any
}

export async function fetchSafeUrl(urlStr: string, options: SafeRequestOptions = {}) {
  const { url, address, family } = await resolveSafeUrl(urlStr)
  const requester = options.requester || (url.protocol === 'https:' ? httpsRequest : httpRequest)
  const timeoutMs = options.timeoutMs ?? 30_000
  return await new Promise<any>((resolve, reject) => {
    const request = requester(url, {
      headers: options.headers,
      signal: options.signal,
      lookup: (_hostname: string, lookupOptions: any, callback: (...args: any[]) => void) => {
        if (typeof lookupOptions === 'function') callback = lookupOptions
        if (lookupOptions?.all) callback(null, [{ address, family }])
        else callback(null, address, family)
      }
    }, (response: any) => {
      const headers = {
        get: (name: string) => {
          const value = response.headers?.[name.toLowerCase()]
          return Array.isArray(value) ? value.join(', ') : value ?? null
        }
      }
      let bodyPromise: Promise<Buffer> | undefined
      const readBody = () => bodyPromise ||= (async () => {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of response) {
          const buffer = Buffer.from(chunk)
          size += buffer.length
          if (size > (options.maxBytes ?? 5 * 1024 * 1024)) {
            response.destroy?.()
            throw new Error('Response exceeds size limit')
          }
          chunks.push(buffer)
        }
        return Buffer.concat(chunks)
      })()
      resolve({
        status: response.statusCode || 0,
        statusText: response.statusMessage || '',
        ok: response.statusCode >= 200 && response.statusCode < 300,
        headers,
        body: response,
        text: async () => (await readBody()).toString('utf8'),
        arrayBuffer: async () => {
          const buffer = await readBody()
          return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        }
      })
    })
    request.on('error', reject)
    request.setTimeout?.(timeoutMs, () => request.destroy(new Error('Request timed out')))
    request.end()
  })
}

// --- Fuzzy match and patch logic (9 strategies) ---
const UNICODE_MAP: Record<string, string> = {
  '\u201c': '"', '\u201d': '"',
  '\u2018': "'", '\u2019': "'",
  '\u2014': '--', '\u2013': '-',
  '\u2026': '...', '\u00a0': ' ',
  '\u2212': '-'
}

function normalizeUnicode(text: string): string {
  let res = text
  for (const [k, v] of Object.entries(UNICODE_MAP)) {
    res = res.replaceAll(k, v)
  }
  return res
}

function countOccurrences(content: string, searchStr: string): number {
  if (!searchStr) return 0
  let count = 0
  let pos = 0
  while ((pos = content.indexOf(searchStr, pos)) !== -1) {
    count++
    pos += searchStr.length
  }
  return count
}

function applyReplace(content: string, block: string, newString: string, replaceAll: boolean): string {
  const sourceIndent = block.split('\n').find(line => line.trim())?.match(/^\s*/)?.[0] || ''
  const replacementIndent = newString.split('\n').find(line => line.trim())?.match(/^\s*/)?.[0] || ''
  const indentDelta = sourceIndent.length - replacementIndent.length
  const replacement = indentDelta > 0
    ? newString.split('\n').map(line => line.trim() ? ' '.repeat(indentDelta) + line : line).join('\n')
    : newString
  if (replaceAll) return content.split(block).join(replacement)
  const idx = content.indexOf(block)
  if (idx === -1) return content
  return content.slice(0, idx) + replacement + content.slice(idx + block.length)
}

export function unescapeString(text: string): string {
  return text
    .replace(/(?<!\\)\\n/g, '\n')
    .replace(/(?<!\\)\\r/g, '\r')
    .replace(/(?<!\\)\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
}

export function fuzzyReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean = false
): { content: string; diff: string; strategy: string } {
  // BUG-03: Reject empty old_string
  if (!oldString) {
    throw new Error('old_string must not be empty')
  }
  
  if (oldString === newString) {
    throw new Error('No edit applied: old_string and new_string are identical.')
  }

  // Strategy 1: Exact match
  if (content.includes(oldString)) {
    if (!replaceAll) {
      const count = countOccurrences(content, oldString)
      if (count > 1) {
        throw new Error(`Found ${count} exact matches. Add more context to old_string or use replace_all=true`)
      }
    }
    const updated = applyReplace(content, oldString, newString, replaceAll)
    return { content: updated, diff: generateDiff(oldString, newString), strategy: 'exact' }
  }

  // Strategy 2: Line trimmed match
  const contentLines = content.split('\n')
  const oldLines = oldString.split('\n')
  const oldTrimmed = oldLines.map(l => l.trim()).join('\n')

  const matches2: string[] = []
  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    const windowTrimmed = contentLines.slice(i, i + oldLines.length).map(l => l.trim()).join('\n')
    if (windowTrimmed === oldTrimmed) {
      matches2.push(contentLines.slice(i, i + oldLines.length).join('\n'))
    }
  }
  if (matches2.length > 0) {
    if (!replaceAll && matches2.length > 1) {
      throw new Error(`Found ${matches2.length} line-trimmed matches. Add more context to old_string or use replace_all=true`)
    }
    const matchedBlock = matches2[0]
    const updated = applyReplace(content, matchedBlock, newString, replaceAll)
    return { content: updated, diff: generateDiff(matchedBlock, newString), strategy: 'line_trimmed' }
  }

  // Strategy 3: Whitespace normalized
  const collapseWs = (s: string) => s.replace(/[ \t]+/g, ' ')
  const oldWs = collapseWs(oldString)
  const matches3: string[] = []
  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    const windowLines = contentLines.slice(i, i + oldLines.length)
    const windowWs = collapseWs(windowLines.join('\n'))
    if (windowWs === oldWs) {
      matches3.push(windowLines.join('\n'))
    }
  }
  if (matches3.length > 0) {
    if (!replaceAll && matches3.length > 1) {
      throw new Error(`Found ${matches3.length} whitespace-normalized matches. Add more context to old_string or use replace_all=true`)
    }
    const matchedBlock = matches3[0]
    const updated = applyReplace(content, matchedBlock, newString, replaceAll)
    return { content: updated, diff: generateDiff(matchedBlock, newString), strategy: 'whitespace_normalized' }
  }

  // Strategy 4: Indentation flexible
  const stripIndent = (lines: string[]) => {
    const minIndent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^\s*/)?.[0].length || 0))
    return lines.map(l => l.slice(minIndent)).join('\n')
  }
  const oldDedented = stripIndent(oldLines)
  const matches4: string[] = []
  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    const windowLines = contentLines.slice(i, i + oldLines.length)
    if (stripIndent(windowLines) === oldDedented) {
      matches4.push(windowLines.join('\n'))
    }
  }
  if (matches4.length > 0) {
    if (!replaceAll && matches4.length > 1) {
      throw new Error(`Found ${matches4.length} indentation-flexible matches. Add more context to old_string or use replace_all=true`)
    }
    const matchedBlock = matches4[0]
    const sourceIndent = matchedBlock.split('\n').find(l => l.trim())?.match(/^\s*/)?.[0] || ''
    const replacement = newString.split('\n').map((line, i) => i === 0 || !line.trim() ? line : sourceIndent + line).join('\n')
    const updated = applyReplace(content, matchedBlock, replacement, replaceAll)
    return { content: updated, diff: generateDiff(matchedBlock, replacement), strategy: 'indentation_flexible' }
  }

  // Strategy 5: Escape normalized
  const oldUnescaped = unescapeString(oldString)
  if (content.includes(oldUnescaped)) {
    if (!replaceAll) {
      const count = countOccurrences(content, oldUnescaped)
      if (count > 1) {
        throw new Error(`Found ${count} escape-normalized matches. Add more context to old_string or use replace_all=true`)
      }
    }
    const updated = applyReplace(content, oldUnescaped, newString, replaceAll)
    return { content: updated, diff: generateDiff(oldUnescaped, newString), strategy: 'escape_normalized' }
  }

  // Strategy 6: Trimmed boundary
  if (oldLines.length > 2) {
    const boundaryTrimmedOld = [
      oldLines[0].trim(),
      ...oldLines.slice(1, -1),
      oldLines[oldLines.length - 1].trim()
    ].join('\n')
    const matches6: string[] = []
    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const windowLines = contentLines.slice(i, i + oldLines.length)
      const windowTrimmed = [
        windowLines[0].trim(),
        ...windowLines.slice(1, -1),
        windowLines[windowLines.length - 1].trim()
      ].join('\n')
      if (windowTrimmed === boundaryTrimmedOld) {
        matches6.push(windowLines.join('\n'))
      }
    }
    if (matches6.length > 0) {
      if (!replaceAll && matches6.length > 1) {
        throw new Error(`Found ${matches6.length} trimmed-boundary matches. Add more context to old_string or use replace_all=true`)
      }
      const matchedBlock = matches6[0]
      const updated = applyReplace(content, matchedBlock, newString, replaceAll)
      return { content: updated, diff: generateDiff(matchedBlock, newString), strategy: 'trimmed_boundary' }
    }
  }

  // Strategy 7: Unicode normalized
  const normOldUnicode = normalizeUnicode(oldString)
  const normContentUnicode = normalizeUnicode(content)
  if (normContentUnicode.includes(normOldUnicode)) {
    if (!replaceAll) {
      const count = countOccurrences(normContentUnicode, normOldUnicode)
      if (count > 1) {
        throw new Error(`Found ${count} unicode-normalized matches. Add more context to old_string or use replace_all=true`)
      }
    }
    
    const ranges: Array<{ start: number; end: number }> = []
    let normalized = ''
    const boundaries = [0]
    for (let i = 0; i < content.length; i++) {
      normalized += normalizeUnicode(content[i])
      boundaries.push(normalized.length)
    }
    let from = 0
    while (from <= normalized.length - normOldUnicode.length) {
      const idx = normalized.indexOf(normOldUnicode, from)
      if (idx < 0) break
      const start = boundaries.findIndex((n, i) => n <= idx && boundaries[i + 1] > idx)
      let end = boundaries.findIndex(n => n >= idx + normOldUnicode.length)
      if (start >= 0 && end > start) ranges.push({ start, end })
      from = idx + Math.max(1, normOldUnicode.length)
    }
    const selected = replaceAll ? ranges : ranges.slice(0, 1)
    let updated = content
    for (const range of selected.reverse()) updated = updated.slice(0, range.start) + newString + updated.slice(range.end)
    const matchedBlock = content.slice(ranges[0].start, ranges[0].end)
    return { content: updated, diff: generateDiff(matchedBlock, newString), strategy: 'unicode_normalized' }
  }

  // Ponytail: reject ambiguous fuzzy blocks; exact/normalized matches remain supported.
  /*
  // Strategy 8: Block anchor
  if (oldLines.length >= 3) {
    const firstLine = oldLines[0].trim()
    const lastLine = oldLines[oldLines.length - 1].trim()
    const matches8: string[] = []
    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      if (contentLines[i].trim() === firstLine && contentLines[i + oldLines.length - 1].trim() === lastLine) {
        matches8.push(contentLines.slice(i, i + oldLines.length).join('\n'))
      }
    }
    if (matches8.length > 0) {
      if (!replaceAll && matches8.length > 1) {
        throw new Error(`Found ${matches8.length} block-anchor matches. Add more context to old_string or use replace_all=true`)
      }
      const matchedBlock = matches8[0]
      const updated = applyReplace(content, matchedBlock, newString, replaceAll)
      return { content: updated, diff: generateDiff(matchedBlock, newString), strategy: 'block_anchor' }
    }
  }

  // Strategy 9: Context-aware similarity match
  let bestMatches: Array<{idx: number, score: number, block: string}> = []
  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let matchedLines = 0
    for (let j = 0; j < oldLines.length; j++) {
      if (contentLines[i + j].trim() === oldLines[j].trim()) {
        matchedLines++
      }
    }
    const score = matchedLines / oldLines.length
    if (score >= 0.9) {
      bestMatches.push({
        idx: i,
        score,
        block: contentLines.slice(i, i + oldLines.length).join('\n')
      })
    }
  }

  if (bestMatches.length > 0) {
    if (!replaceAll && bestMatches.length > 1) {
      throw new Error(`Found ${bestMatches.length} similarity matches (≥90%). Add more context to old_string or use replace_all=true`)
    }
    const matchedBlock = bestMatches[0].block
    const updated = applyReplace(content, matchedBlock, newString, replaceAll)
    const warning = `Fuzzy match with ${Math.round(bestMatches[0].score * 100)}% similarity`
    return { 
      content: updated, 
      diff: generateDiff(matchedBlock, newString) + `\n\n[WARNING: ${warning}]`, 
      strategy: 'similarity_match' 
    }
  }
  */

  throw new Error(`Failed to find unique match for replacement after trying 9 matching strategies. Verify old_string exists in file.`)
}

function generateUnifiedFileDiff(oldText: string, newText: string, filePath: string): string {
  if (oldText === '') {
    const lines = newText.split('\n')
    if (lines.at(-1) === '') lines.pop()
    const body = lines.length ? `@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}` : ''
    return `--- a/${filePath}\n+++ b/${filePath}${body ? `\n${body}` : ''}`
  }
  return `--- a/${filePath}\n+++ b/${filePath}\n${generateDiff(oldText, newText)}`
}

function previewDiff(diff: string, maxChars = 20_000, maxLines = 120): { diff: string; omittedLines: number; lineTruncated: boolean } {
  const lines = diff.split('\n')
  const kept: string[] = []
  let chars = 0
  let lineTruncated = false
  for (const line of lines) {
    if (kept.length >= maxLines) break
    const separator = kept.length ? 1 : 0
    const remaining = maxChars - chars - separator
    if (line.length > remaining) {
      if (remaining > 0) {
        kept.push(line.slice(0, remaining))
        lineTruncated = true
      }
      break
    }
    kept.push(line)
    chars += line.length + separator
  }
  return { diff: kept.join('\n'), omittedLines: lines.length - kept.length + Number(lineTruncated), lineTruncated }
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function recordFileRead(context: ToolContext, path: string, text: string, totalLines: number, offset: number, count: number): void {
  if (!context.fileReadCoverage || count < 1) return
  const key = realpathSync(path)
  const hash = hashText(text)
  const previous = context.fileReadCoverage.get(key)
  const coverage = previous?.hash === hash && previous.totalLines === totalLines
    ? previous
    : { hash, totalLines, ranges: [] }
  const ranges = [...coverage.ranges, [offset, Math.min(totalLines, offset + count - 1)] as [number, number]]
    .sort((a, b) => a[0] - b[0])
  coverage.ranges = []
  for (const range of ranges) {
    const last = coverage.ranges.at(-1)
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1])
    else coverage.ranges.push([...range])
  }
  if (!previous && context.fileReadCoverage.size >= 256) {
    const oldest = context.fileReadCoverage.keys().next().value
    if (oldest) context.fileReadCoverage.delete(oldest)
  }
  context.fileReadCoverage.set(key, coverage)
}

function fileReadStatus(context: ToolContext, path: string, text: string): 'unread' | 'stale' | 'partial' | 'ready' {
  if (!context.fileReadCoverage) return 'unread'
  const coverage = context.fileReadCoverage.get(realpathSync(path))
  if (!coverage) return 'unread'
  if (coverage.hash !== hashText(text) || coverage.totalLines !== text.split('\n').length) return 'stale'
  return coverage.ranges.some(([start, end]) => start <= 1 && end >= coverage.totalLines) ? 'ready' : 'partial'
}

function recordWrittenFile(context: ToolContext, path: string, text: string): void {
  if (!context.fileReadCoverage) return
  const key = realpathSync(path)
  if (!context.fileReadCoverage.has(key) && context.fileReadCoverage.size >= 256) {
    const oldest = context.fileReadCoverage.keys().next().value
    if (oldest) context.fileReadCoverage.delete(oldest)
  }
  const totalLines = text.split('\n').length
  context.fileReadCoverage.set(key, { hash: hashText(text), totalLines, ranges: [[1, totalLines]] })
}

function generateDiff(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const rows: string[] = []
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++
  let suffix = 0
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines.at(-1 - suffix) === newLines.at(-1 - suffix)) suffix++
  const contextBefore = Math.min(3, prefix)
  const contextAfter = Math.min(3, suffix)
  const start = prefix - contextBefore
  const oldCount = contextBefore + (oldLines.length - prefix - suffix) + contextAfter
  const newCount = contextBefore + (newLines.length - prefix - suffix) + contextAfter
  rows.push(`@@ -${start + 1},${oldCount} +${start + 1},${newCount} @@`)
  rows.push(...oldLines.slice(start, prefix).map(line => ` ${line}`))
  rows.push(...oldLines.slice(prefix, oldLines.length - suffix).map(line => `-${line}`))
  rows.push(...newLines.slice(prefix, newLines.length - suffix).map(line => `+${line}`))
  rows.push(...oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + contextAfter).map(line => ` ${line}`))
  return rows.join('\n')
}

export function isTruthy(val: any): boolean {
  if (val === true || val === 1) return true
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'yes' || s === 'y'
  }
  return false
}

function truncateOutput(text: string, maxBytes: number = 50_000): { text: string; truncated: boolean; spillPath?: string } {
  const buf = Buffer.from(text, 'utf-8')
  if (buf.length <= maxBytes) return { text, truncated: false }
  const headBytes = Math.floor(maxBytes * 0.4)
  const tailBytes = Math.floor(maxBytes * 0.6)
  const head = buf.subarray(0, headBytes).toString('utf-8').replace(/\uFFFD$/, '')
  const tail = buf.subarray(buf.length - tailBytes).toString('utf-8').replace(/^\uFFFD/, '')

  let spillPath: string | undefined
  try {
    const scratchDir = join(homedir(), '.vallenatrix', 'scratch')
    mkdirSync(scratchDir, { recursive: true, mode: 0o700 })
    const now = Date.now()
    for (const name of readdirSync(scratchDir)) {
      if (/^output-\d+-[a-f0-9]+\.log$/.test(name)) {
        try { if (now - statSync(join(scratchDir, name)).mtimeMs > 86_400_000) unlinkSync(join(scratchDir, name)) } catch {}
      }
    }
    const digest = Buffer.from(text.slice(0, 100)).toString('hex').slice(0, 8)
    spillPath = join(scratchDir, `output-${now}-${digest}.log`)
    writeFileSync(spillPath, text, { encoding: 'utf-8', mode: 0o600 })
  } catch {}

  const spillNotice = spillPath ? ` (FULL output saved to ${spillPath} — page with read_file if needed)` : ''

  return {
    text: `${head}\n\n[... Truncated ${buf.length - maxBytes} bytes${spillNotice} ...]\n\n${tail}`,
    truncated: true,
    spillPath
  }
}

let builtinToolsRegistered = false

// --- Tools Implementation ---

export function registerBuiltinTools(
  skillLoader?: SkillLoader,
  memoryStore?: MemoryStore,
  todoStore?: TodoStore,
  delegateAgentFactory?: (goal: string) => Promise<string>,
  isSubagent: boolean = false,
  force: boolean = false
): void {
  if (builtinToolsRegistered && !force) return
  builtinToolsRegistered = true

  const memory = memoryStore || new MemoryStore()
  const todo = todoStore || new TodoStore()

  // 1. read_file
  const readFileSchema: ToolSchema = {
    name: 'read_file',
    description: "Read a text file with line numbers and pagination. Existing files must be fully read with read_file before write_file may overwrite them. Output format: 'LINE_NUM|CONTENT'. Use offset and limit for large files.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read (absolute, relative, or ~/path)' },
        offset: { type: 'integer', description: 'Line number to start reading from (1-indexed, default: 1)' },
        limit: { type: 'integer', description: 'Maximum number of lines to read (default: 2000, max: 2000)' }
      },
      required: ['path']
    }
  }

  registry.register({
    name: 'read_file',
    schema: readFileSchema,
    toolset: 'file',
    parallelSafe: true,
    handler: async (args, context) => {
      const basePath = context.workingDir || process.cwd()
      let rawPath = args.path as string
      if (rawPath.startsWith('~/')) {
        rawPath = join(homedir(), rawPath.slice(2))
      }
      const fullPath = isAbsolute(rawPath) ? rawPath : resolve(basePath, rawPath)

      if (!existsSync(fullPath)) {
        return JSON.stringify({ error: `File not found: ${rawPath}` })
      }

      // BUG-04: Check file type and size before reading
      try {
        const stats = statSync(fullPath)
        
        // Only read regular files
        if (!stats.isFile()) {
          return JSON.stringify({ error: `Not a regular file: ${rawPath}` })
        }
        
        // Reject files > 10 MB
        const maxSize = 10 * 1024 * 1024
        if (stats.size > maxSize) {
          return JSON.stringify({ 
            error: `File too large: ${(stats.size / 1024 / 1024).toFixed(1)} MB (max 10 MB)`,
            hint: 'Use terminal with head/tail for large files'
          })
        }
        
        // Detect binary files
        const fd = openSync(fullPath, 'r')
        const buffer = Buffer.alloc(8192)
        let bytesRead: number
        try {
          bytesRead = readSync(fd, buffer, 0, 8192, 0)
        } finally {
          closeSync(fd)
        }
        
        if (buffer.slice(0, bytesRead).includes(0)) {
          const dotIdx = fullPath.lastIndexOf('.')
          const ext = dotIdx !== -1 ? fullPath.slice(dotIdx).toLowerCase() : ''
          const isImg = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp'].includes(ext)
          if (isImg) {
            return JSON.stringify({
              error: `Image file detected (${ext}): ${rawPath}. Cannot read image bytes with read_file.`,
              hint: `Use vision_analyze with image_url="${rawPath}" and question="..." to inspect this image.`
            })
          }
          return JSON.stringify({ error: `Binary file detected: ${rawPath}` })
        }
      } catch (err: any) {
        return JSON.stringify({ error: `Cannot stat file: ${err.message}` })
      }

      try {
        const fileContent = readFileSync(fullPath, 'utf-8')
        const allLines = fileContent.split('\n')
        const offset = Math.max(1, Number(args.offset) || 1)
        const limit = Math.max(0, Math.min(2000, Number(args.limit) || 2000))

        const startIdx = offset - 1
        const sliceLines = allLines.slice(startIdx, startIdx + limit)
        const maxChars = 100_000
        const maxLineChars = 50_000

        let charCount = 0
        let truncated = false
        const keptLines: string[] = []

        for (let i = 0; i < sliceLines.length; i++) {
          const lineNum = offset + i
          let lineContent = sliceLines[i]
          let lineTruncated = false
          
          if (lineContent.length > maxLineChars) {
            lineContent = lineContent.slice(0, maxLineChars) + '... [line truncated]'
            lineTruncated = true
          }
          
          const formattedLine = `${lineNum}|${lineContent}`
          if (charCount + formattedLine.length + 1 > maxChars) {
            truncated = true
            break
          }
          keptLines.push(formattedLine)
          charCount += formattedLine.length + 1
          if (lineTruncated) {
            truncated = true
          }
        }

        const result: Record<string, any> = {
          content: keptLines.join('\n'),
          total_lines: allLines.length,
          offset,
          limit
        }

        if (truncated) {
          result.truncated = true
          const nextOff = offset + Math.max(1, keptLines.length)
          result.next_offset = nextOff
          result.hint = `Output truncated at 100K char limit after ${keptLines.length} lines. Use offset=${nextOff} to continue.`
        } else {
          recordFileRead(context, fullPath, fileContent, allLines.length, offset, keptLines.length)
        }

        return JSON.stringify(result)
      } catch (err: any) {
        return JSON.stringify({ error: err.message || 'Failed to read file' })
      }
    }
  })

  // 2. write_file
  const writeFileSchema: ToolSchema = {
    name: 'write_file',
    description: "Write content to a file. Creates parent directories. Existing files require a complete prior read_file; use patch for targeted edits. New TypeScript diagnostics are returned in lsp_diagnostics when a project tsconfig is available.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to write (will be created if it does not exist)' },
        content: { type: 'string', description: 'Complete content to write to the file' }
      },
      required: ['path', 'content']
    }
  }

  registry.register({
    name: 'write_file',
    schema: writeFileSchema,
    toolset: 'file',
    handler: async (args, context) => {
      const basePath = context.workingDir || process.cwd()
      let rawPath = args.path as string
      if (rawPath.startsWith('~/')) {
        rawPath = join(homedir(), rawPath.slice(2))
      }
      const fullPath = isAbsolute(rawPath) ? rawPath : resolve(basePath, rawPath)
      const content = String(args.content ?? '')
      const diagnosticsBefore = captureTypeScriptDiagnostics(fullPath, basePath)

      let destination = fullPath
      let previousContent: string | null = ''
      let diffOmitted: string | undefined
      try {
        mkdirSync(dirname(fullPath), { recursive: true })
        if (existsSync(fullPath) && lstatSync(fullPath).isSymbolicLink()) destination = realpathSync(fullPath)
        if (existsSync(destination)) {
          const info = statSync(destination)
          if (!info.isFile()) return JSON.stringify({ error: 'Refusing to overwrite a non-regular file.' })
          if (info.size > 10 * 1024 * 1024) return JSON.stringify({ error: 'Refusing to overwrite a file over 10 MB; use a targeted patch or reduce it first.' })
          const previous = readFileSync(destination)
          if (previous.includes(0)) return JSON.stringify({ error: 'Refusing to overwrite binary file; read_file cannot verify its contents.' })
          const previousText = previous.toString('utf-8')
          const readStatus = fileReadStatus(context, destination, previousText)
          if (readStatus === 'unread') return JSON.stringify({ error: 'Refusing to overwrite existing file: read it with read_file first.' })
          if (readStatus === 'stale') return JSON.stringify({ error: 'File changed since read_file; read the current version again before writing.' })
          if (readStatus === 'partial') return JSON.stringify({ error: 'Refusing to overwrite: read the complete current file with read_file first.' })
          if (info.size > 1_000_000) {
            diffOmitted = 'Diff omitted: existing file exceeds 1 MB.'
            previousContent = null
          } else previousContent = previousText
        } else {
          previousContent = ''
        }
      } catch (err: any) { return JSON.stringify({ error: err.message || 'Failed to resolve file path' }) }
      const tempPath = `${destination}.tmp-${process.pid}`
      try {
        const mode = existsSync(destination) ? statSync(destination).mode : undefined
        writeFileSync(tempPath, content, { encoding: 'utf-8', mode })
        if (mode !== undefined) chmodSync(tempPath, mode)
        renameSync(tempPath, destination)
        const verified = readFileSync(destination, 'utf-8') === content
        if (!verified) return JSON.stringify({ error: 'Write verification failed' })
        recordWrittenFile(context, destination, content)
        const lspDiagnostics = newTypeScriptDiagnostics(diagnosticsBefore, captureTypeScriptDiagnostics(fullPath, basePath))
        const fileDiff = previousContent !== null && previousContent !== content
          ? generateUnifiedFileDiff(previousContent, content, relative(basePath, fullPath) || basename(fullPath))
          : undefined
        const diffPreview = fileDiff ? previewDiff(fileDiff) : undefined
        return JSON.stringify({
          success: true,
          path: fullPath,
          bytes_written: Buffer.byteLength(content, 'utf-8'),
          verified,
          ...(lspDiagnostics ? { lsp_diagnostics: lspDiagnostics } : {}),
          ...(diffPreview ? { diff: diffPreview.diff } : {}),
          ...(diffPreview?.omittedLines
            ? { diff_truncated: true, diff_omitted_lines: diffPreview.omittedLines }
            : previousContent === content
              ? { diff_omitted: 'Diff omitted: file content is unchanged.' }
              : diffOmitted ? { diff_omitted: diffOmitted } : {})
        })
      } catch (err: any) {
        try { unlinkSync(tempPath) } catch {}
        return JSON.stringify({ error: err.message || 'Failed to write file' })
      }
    }
  })

  // 3. patch
  const patchSchema: ToolSchema = {
    name: 'patch',
    description: "Targeted find-and-replace edits in files. Uses 9-strategy fuzzy matching so minor whitespace/indentation differences won't break it. Returns unified diff.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit' },
        old_string: { type: 'string', description: 'Exact text to find and replace. Must be unique unless replace_all=true.' },
        new_string: { type: 'string', description: 'Changed replacement text' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences instead of requiring a unique match (default: false)' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  }

  registry.register({
    name: 'patch',
    schema: patchSchema,
    toolset: 'file',
    handler: async (args, context) => {
      const basePath = context.workingDir || process.cwd()
      let rawPath = args.path as string
      if (rawPath.startsWith('~/')) {
        rawPath = join(homedir(), rawPath.slice(2))
      }
      const fullPath = isAbsolute(rawPath) ? rawPath : resolve(basePath, rawPath)

      if (!existsSync(fullPath)) {
        return JSON.stringify({ error: `File not found: ${rawPath}` })
      }

      try {
        const bytes = readFileSync(fullPath)
        if (bytes.includes(0)) return JSON.stringify({ error: 'Cannot patch binary file' })
        const content = bytes.toString('utf-8')
        const diagnosticsBefore = captureTypeScriptDiagnostics(fullPath, basePath)
        const oldString = String(args.old_string ?? '')
        const newString = String(args.new_string ?? '')
        const replaceAll = isTruthy(args.replace_all)

        const result = fuzzyReplace(content, oldString, newString, replaceAll)
        const tempPath = `${fullPath}.tmp-${process.pid}`
        try { writeFileSync(tempPath, result.content, 'utf-8'); renameSync(tempPath, fullPath) } catch (err) { try { unlinkSync(tempPath) } catch {}; throw err }
        recordWrittenFile(context, fullPath, result.content)
        const lspDiagnostics = newTypeScriptDiagnostics(diagnosticsBefore, captureTypeScriptDiagnostics(fullPath, basePath))

        return JSON.stringify({
          success: true,
          path: fullPath,
          strategy: result.strategy,
          diff: result.diff,
          ...(lspDiagnostics ? { lsp_diagnostics: lspDiagnostics } : {})
        })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || 'Failed to patch file' })
      }
    }
  })

  // 4. search_files
  const searchFilesSchema: ToolSchema = {
    name: 'search_files',
    description: "Search file contents or find files by name. Use this instead of grep/find/ls in terminal.\nContent search (target='content'): Regex search inside files.\nFile search (target='files'): Find files by glob/name pattern.",
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: "Regex pattern for content search, or glob pattern (e.g., '*.py') for file search" },
        target: { type: 'string', enum: ['content', 'files'], description: "'content' searches inside file contents, 'files' searches for files by name", default: 'content' },
        path: { type: 'string', description: 'Directory or file to search in (default: current working directory)', default: '.' },
        file_glob: { type: 'string', description: "Filter files by pattern in grep mode (e.g., '*.py')" },
        limit: { type: 'integer', description: 'Maximum number of results to return (default: 50)', default: 50 },
        offset: { type: 'integer', description: 'Skip first N results for pagination (default: 0)', default: 0 }
      },
      required: ['pattern']
    }
  }

  registry.register({
    name: 'search_files',
    schema: searchFilesSchema,
    toolset: 'file',
    parallelSafe: true,
    handler: async (args, context) => {
      const basePath = context.workingDir || process.cwd()
      let searchDir = String(args.path || '.')
      if (searchDir.startsWith('~/')) {
        searchDir = join(homedir(), searchDir.slice(2))
      }
      const fullSearchDir = isAbsolute(searchDir) ? searchDir : resolve(basePath, searchDir)
      const target = (args.target || 'content') as 'content' | 'files'
      const pattern = String(args.pattern || '')
      const limit = Math.max(0, Math.min(200, Number(args.limit) || 50))
      const offset = Math.max(0, Number(args.offset) || 0)

      if (!existsSync(fullSearchDir)) {
        return JSON.stringify({ error: `Directory not found: ${searchDir}` })
      }

      // A single-file path must be searched directly: walking readdirSync on a file
      // throws and was silently swallowed, returning zero matches.
      if (statSync(fullSearchDir).isFile()) {
        const fileTarget = fullSearchDir
        if (target === 'files') {
          const globReg = globToRegex(pattern)
          const hit = globReg.test(basename(fileTarget)) || globReg.test(relative(dirname(fileTarget), fileTarget))
          return JSON.stringify({ files: hit ? [fileTarget] : [], total_count: hit ? 1 : 0, truncated: false })
        }
        let fileRegex: RegExp
        try {
          fileRegex = new RegExp(pattern, 'i')
        } catch {
          fileRegex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        }
        const fileMatches: Array<{ file: string; line: number; content: string }> = []
        try {
          for (const [idx, lineText] of readFileSync(fileTarget, 'utf-8').split('\n').entries()) {
            if (fileRegex.test(lineText)) {
              fileMatches.push({ file: fileTarget, line: idx + 1, content: lineText.slice(0, 300) })
              if (fileMatches.length >= offset + limit) break
            }
          }
        } catch {}
        return JSON.stringify({
          matches: fileMatches.slice(offset, offset + limit),
          total_count: fileMatches.length,
          truncated: fileMatches.length > offset + limit
        })
      }

      if (target === 'files') {
        const foundFiles: string[] = []
        const regex = globToRegex(pattern)

        function walk(dir: string) {
          if (foundFiles.length >= offset + limit + 1) return
          try {
            const entries = readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (foundFiles.length >= offset + limit + 1) return
              const skipDirs = ['.git', 'node_modules', 'dist', 'build', '.next']
              if (entry.isDirectory() && skipDirs.includes(entry.name)) continue
              
              const subPath = join(dir, entry.name)
              if (entry.isDirectory()) {
                walk(subPath)
              } else if (entry.isFile()) {
                if (regex.test(entry.name) || regex.test(relative(fullSearchDir, subPath))) {
                  foundFiles.push(subPath)
                }
              }
            }
          } catch {}
        }

        walk(fullSearchDir)
        const paged = foundFiles.slice(offset, offset + limit)
        return JSON.stringify({
          files: paged,
          total_count: foundFiles.length,
          truncated: foundFiles.length > offset + limit
        })
      }

      const contentMatches: Array<{ file: string; line: number; content: string }> = []
      let regex: RegExp
      try {
        regex = new RegExp(pattern, 'i')
      } catch {
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      }

      function searchDirContents(dir: string) {
        if (contentMatches.length >= offset + limit) return
        try {
          const entries = readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            if (contentMatches.length >= offset + limit) return
            const skipDirs = ['.git', 'node_modules', 'dist', 'build', '.next']
            if (entry.isDirectory() && skipDirs.includes(entry.name)) continue
            
            const subPath = join(dir, entry.name)
            if (entry.isDirectory()) {
              searchDirContents(subPath)
            } else if (entry.isFile()) {
              const skipExts = ['.png', '.jpg', '.jpeg', '.gif', '.mp4', '.mkv', '.zip', '.tar', '.gz', '.bin', '.exe', '.so', '.dylib', '.iso', '.pdf', '.woff', '.woff2', '.ttf', '.pyc', '.wasm']
              const dotIdx = entry.name.lastIndexOf('.')
              const ext = dotIdx !== -1 ? entry.name.slice(dotIdx).toLowerCase() : ''
              if (skipExts.includes(ext)) continue

              if (args.file_glob) {
                const globReg = globToRegex(String(args.file_glob))
                if (!globReg.test(entry.name)) continue
              }
              try {
                const st = statSync(subPath)
                if (st.size > 2 * 1024 * 1024) continue // Skip files > 2MB in recursive content search
                const fileText = readFileSync(subPath, 'utf-8')
                const lines = fileText.split('\n')
                for (let idx = 0; idx < lines.length; idx++) {
                  if (regex.test(lines[idx])) {
                    contentMatches.push({
                      file: subPath,
                      line: idx + 1,
                      content: lines[idx].slice(0, 300)
                    })
                    if (contentMatches.length >= offset + limit) break
                  }
                }
              } catch {}
            }
          }
        } catch {}
      }

      searchDirContents(fullSearchDir)
      const paged = contentMatches.slice(offset, offset + limit)
      return JSON.stringify({
        matches: paged,
        total_count: contentMatches.length,
        truncated: contentMatches.length > offset + limit
      })
    }
  })

  // 4b. session_search — recall past work from saved sessions
  const sessionSearchSchema: ToolSchema = {
    name: 'session_search',
    description: 'Search saved past sessions for earlier work, decisions, or commands. Returns matching sessions with snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to search for (topic, file, command)' },
        limit: { type: 'integer', description: 'Maximum number of sessions to return (default 10)' }
      },
      required: ['query']
    }
  }

  registry.register({
    name: 'session_search',
    schema: sessionSearchSchema,
    toolset: 'memory',
    handler: async (args) => {
      const query = String(args.query || '').trim()
      if (!query) return JSON.stringify({ error: 'query is required' })
      const limit = Number(args.limit) || 10
      const hits = searchSessions(query, { limit })
      return JSON.stringify({
        query,
        matches: hits.length,
        results: hits.map(hit => ({ session: hit.sessionId, score: hit.score, terms: hit.matchedTerms, snippet: hit.snippet })),
        formatted: formatHits(hits)
      })
    }
  })

  // 5. terminal
  const terminalSchema: ToolSchema = {
    name: 'terminal',
    description: 'Execute shell commands on the host machine. Returns stdout, stderr, and exit code.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        workdir: { type: 'string', description: 'Working directory for this command' },
        timeout: { type: 'integer', description: 'Timeout in seconds (default: 120)' },
        background: { type: 'boolean', description: 'Start command in background and return a session_id for process_manage' },
        notify: { type: 'boolean', description: 'Emit process exit status through terminal output callback when background process ends' }
      },
      required: ['command']
    }
  }

  registry.register({
    name: 'terminal',
    schema: terminalSchema,
    toolset: 'terminal',
    handler: async (args, context, signal) => {
      const rawCommand = String(args.command || '').trim()
      const requestedDir = String(args.workdir || context.workingDir || process.cwd())
      const workdir = isAbsolute(requestedDir) ? requestedDir : resolve(context.workingDir || process.cwd(), requestedDir)
      const timeout = (Number(args.timeout) || 120) * 1000

      if (!existsSync(workdir) || !statSync(workdir).isDirectory()) {
        return JSON.stringify({ exit_code: 1, error: `Working directory does not exist or is not a directory: ${workdir}` })
      }

      // Direct single "cd <dir>" handler
      if (rawCommand.startsWith('cd ') && !rawCommand.includes('&&') && !rawCommand.includes(';') && !rawCommand.includes('|')) {
        let targetDir = rawCommand.slice(3).trim()
        if (targetDir.startsWith('"') && targetDir.endsWith('"')) targetDir = targetDir.slice(1, -1)
        if (targetDir.startsWith("'") && targetDir.endsWith("'")) targetDir = targetDir.slice(1, -1)
        if (targetDir === '~') targetDir = homedir()
        else if (targetDir.startsWith('~/')) targetDir = join(homedir(), targetDir.slice(2))
        const resolved = isAbsolute(targetDir) ? targetDir : resolve(workdir, targetDir)
        if (existsSync(resolved) && statSync(resolved).isDirectory()) {
          context.workingDir = resolved
          return JSON.stringify({
            exit_code: 0,
            output: `Changed working directory to ${resolved}`,
            cwd: resolved
          })
        }
      }

      if (args.background === true) {
        const onExit = args.notify === true ? (sessionId: string, exitCode: number | null, processSignal: string | null) => {
          context.onTerminalOutput?.('stderr', `\n[Background process ${sessionId} exited with exit code ${exitCode ?? 'unknown'}${processSignal ? ` (${processSignal})` : ''}]\n`)
        } : undefined
        return JSON.stringify(startBackgroundProcess(rawCommand, workdir, context.sessionId || 'default', onExit))
      }

      // Probe command to detect chained cd transitions
      const isBackground = /(?:^|[;&|])\s*[^;&|]+\s*&\s*$/.test(rawCommand)
      const probeCommand = isBackground ? rawCommand : `${rawCommand}\n__RET=$?; printf '\n__VALLEN_CWD__=%s\n' "$(pwd)"; exit $__RET`

      return new Promise<string>((resolveResult) => {
        const proc = spawn('/bin/sh', ['-c', probeCommand], {
          cwd: workdir,
          detached: true,
          stdio: isBackground ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'pipe', 'pipe']
        })

        let stdout = ''
        let stderr = ''
        let killed = false
        const MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10MB in-memory cap to prevent OOM
        let exceededBufferCap = false

        proc.stdout?.on('data', (chunk: Buffer) => {
          context.onTerminalOutput?.('stdout', chunk.toString())
          if (stdout.length < MAX_OUTPUT_BYTES) {
            stdout += chunk.toString()
          } else if (!exceededBufferCap) {
            exceededBufferCap = true
            stdout += '\n[Output stream exceeded 10MB buffer limit, killing process...]'
            try {
              if (proc.pid) process.kill(-proc.pid, 'SIGKILL')
            } catch {}
          }
        })
        proc.stderr?.on('data', (chunk: Buffer) => {
          context.onTerminalOutput?.('stderr', chunk.toString())
          if (stderr.length < MAX_OUTPUT_BYTES) {
            stderr += chunk.toString()
          }
        })

        const timeoutHandle = setTimeout(() => {
          killed = true
          try {
            if (proc.pid) process.kill(-proc.pid, 'SIGKILL')
          } catch {}
        }, timeout)

        let interrupted = false
        if (signal) {
          if (signal.aborted) {
            interrupted = true
            killed = true
            try {
              if (proc.pid) process.kill(-proc.pid, 'SIGKILL')
            } catch {}
          } else {
            signal.addEventListener('abort', () => {
              interrupted = true
              killed = true
              try {
                if (proc.pid) process.kill(-proc.pid, 'SIGKILL')
              } catch {}
            }, { once: true })
          }
        }

        proc.on('error', (err: any) => {
          clearTimeout(timeoutHandle)
          resolveResult(JSON.stringify({
            exit_code: 1,
            output: '',
            error: err.message || 'Process error'
          }))
        })

        proc.on('close', (code: number | null, signalName: string | null) => {
          clearTimeout(timeoutHandle)

          if (interrupted || signal?.aborted) {
            return resolveResult(JSON.stringify({
              exit_code: 130,
              output: '',
              error: 'Interrupted'
            }))
          }
          
          let output = stdout || ''
          const cwdMarker = '\n__VALLEN_CWD__='
          const markerIdx = output.lastIndexOf(cwdMarker)
          if (markerIdx !== -1) {
            const detectedCwd = output.slice(markerIdx + cwdMarker.length).trim()
            output = output.slice(0, markerIdx)
            if (detectedCwd && resolve(detectedCwd) !== resolve(workdir) && existsSync(detectedCwd) && statSync(detectedCwd).isDirectory()) {
              context.workingDir = detectedCwd
            }
          }

          const exitCode = killed ? 124 : (code ?? 1)
          const rawOutput = (output + (stderr ? `\n[STDERR]\n${stderr}` : '')).trim()
          const { text: truncatedOut } = truncateOutput(rawOutput, 50_000)
          const result: any = {
            exit_code: exitCode,
            output: truncatedOut,
            cwd: context.workingDir
          }
          if (killed || signalName) {
            result.timed_out = true
            result.signal = signalName || 'SIGKILL'
          }
          if (exitCode !== 0 && (code !== null || killed)) {
            result.error = killed ? 'Command timed out' : `Process exited with code ${code}`
          }
          resolveResult(JSON.stringify(result))
        })
      })
    }
  })

  // 6. process_manage
  const processManageSchema: ToolSchema = {
    name: 'process_manage',
    description: 'List, poll, wait for, or stop background terminal processes by session_id.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'poll', 'wait', 'kill'] },
        session_id: { type: 'string' },
        timeout: { type: 'integer', description: 'Maximum seconds to wait (0–300)' }
      },
      required: ['action']
    }
  }
  registry.register({
    name: 'process_manage',
    schema: processManageSchema,
    toolset: 'terminal',
    handler: async (args, context) => JSON.stringify(await manageProcess(args, context.sessionId || 'default'))
  })

  // 7. execute_code
  const executeCodeSchema: ToolSchema = {
    name: 'execute_code',
    description: 'Execute Python code in a subprocess (not sandboxed) with stdlib and environment access. Stdout/stderr returned with head/tail truncation at 50KB.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python code to execute' },
        timeout_s: { type: 'integer', description: 'Timeout in seconds (default: 300)' }
      },
      required: ['code']
    }
  }

  registry.register({
    name: 'execute_code',
    schema: executeCodeSchema,
    toolset: 'code_execution',
    handler: async (args, context, signal) => {
      const code = String(args.code || '')
      const workdir = context.workingDir || process.cwd()
      const timeout = (Number(args.timeout_s) || 300) * 1000

      return new Promise<string>((resolveResult) => {
        let child: any = null
        let tempDir: string | undefined
        let settled = false
        let timedOut = false
        let timeoutTimer: NodeJS.Timeout | undefined
        const abortChild = () => { try { if (child?.pid) process.kill(-child.pid, 'SIGKILL') } catch { try { child?.kill?.('SIGKILL') } catch {} } }
        const args = ['-c', code]
        if (Buffer.byteLength(code) > 100_000) {
          try {
            tempDir = mkdtempSync(join(tmpdir(), 'vallenatrix-code-'))
            writeFileSync(join(tempDir, 'script.py'), code, { mode: 0o600 })
            args.splice(0, args.length, join(tempDir, 'script.py'))
          } catch (err: any) {
            return resolveResult(JSON.stringify({ exit_code: 1, output: '', error: `Could not stage code: ${err.message}` }))
          }
        }
        const finish = (result: string) => {
          if (settled) return
          settled = true
          if (timeoutTimer) clearTimeout(timeoutTimer)
          signal?.removeEventListener('abort', abortChild)
          if (tempDir) { try { rmSync(tempDir, { recursive: true, force: true }) } catch {} }
          resolveResult(result)
        }
        const stdoutParts: Buffer[] = []
        const stderrParts: Buffer[] = []
        let capturedBytes = 0
        let bufferExceeded = false
        const collect = (parts: Buffer[]) => (chunk: Buffer) => {
          const available = 10 * 1024 * 1024 - capturedBytes
          if (available > 0) {
            const kept = chunk.subarray(0, available)
            parts.push(kept)
            capturedBytes += kept.length
          }
          if (chunk.length > available && !bufferExceeded) { bufferExceeded = true; abortChild() }
        }
        child = spawn('python3', args, { cwd: workdir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
        child.stdout.on('data', collect(stdoutParts))
        child.stderr.on('data', collect(stderrParts))
        child.on('close', (code: number | null, closeSignal: string | null) => {
          if (signal?.aborted) return finish(JSON.stringify({ exit_code: 130, output: '', error: 'Interrupted' }))
          const stdout = Buffer.concat(stdoutParts).toString()
          const stderr = Buffer.concat(stderrParts).toString()
          const rawOutput = (stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')).trim()
          const { text: output, truncated } = truncateOutput(rawOutput, 50_000)
          const exitCode = code ?? (closeSignal ? 128 : 1)
          const result: any = { exit_code: exitCode, stdout: output, truncated }
          if (timedOut) result.timed_out = true
          if (closeSignal) result.signal = closeSignal
          if (bufferExceeded) result.error = 'Process output exceeded 10 MB'
          else if (timedOut) result.error = 'Process timed out'
          finish(JSON.stringify(result))
        })
        if (signal?.aborted) abortChild()
        else signal?.addEventListener('abort', abortChild, { once: true })
        timeoutTimer = setTimeout(() => { timedOut = true; abortChild() }, timeout)
        child.on('error', (err: any) => finish(JSON.stringify({ exit_code: 1, output: '', error: err.message || 'Process error' })))
      })
    }
  })

  // 7. web_search
  const webSearchSchema: ToolSchema = {
    name: 'web_search',
    description: 'Search the web for information. Returns title, url, and description snippet of matching web pages.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'integer', description: 'Maximum number of results to return (default: 5)' }
      },
      required: ['query']
    }
  }

  registry.register({
    name: 'web_search',
    schema: webSearchSchema,
    toolset: 'web',
    parallelSafe: true,
    handler: async (args, context) => {
      const query = String(args.query || '').trim()
      const limit = Math.min(10, Math.max(1, Number(args.limit) || 5))

      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        const res = await fetchSafeUrl(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(15000), timeoutMs: 15000, requester: context?.httpRequester
        })
        if (!res.ok) {
          return JSON.stringify({
            error: `Search request failed with HTTP ${res.status}: ${res.statusText}`
          })
        }
        const html = await res.text()

        const results: Array<{ title: string; url: string; description: string }> = []
        const titleMatches = [...html.matchAll(/<a class="result__a[^>]*>([\s\S]*?)<\/a>/g)]
        const snippetMatches = [...html.matchAll(/<a class="result__snippet[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
        const decodeEntities = (value: string) => value
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
          .replace(/&#(\d+);/g, (entity, n) => { const point = Number(n); return point <= 0x10ffff ? String.fromCodePoint(point) : entity })
          .replace(/&#x([\da-f]+);/gi, (entity, n) => { const point = parseInt(n, 16); return point <= 0x10ffff ? String.fromCodePoint(point) : entity })
        for (const [index, m] of snippetMatches.slice(0, limit).entries()) {
          let rawUrl = m[1]
          if (rawUrl.includes('uddg=')) {
            const match = rawUrl.match(/[?&]uddg=([^&]+)/)
            if (match) { try { rawUrl = decodeURIComponent(match[1]) } catch {} }
          }
          const stripHtml = (value: string) => decodeEntities(value.replace(/<[^>]+>/g, '').trim())
          const snippet = stripHtml(m[2])
          const title = titleMatches[index]?.[1] ? stripHtml(titleMatches[index][1]) : snippet.slice(0, 80)
          results.push({ title, url: rawUrl, description: snippet })
        }

        if (results.length === 0) {
          return JSON.stringify({
            error: 'No search results found (parsing failed or blocked by CAPTCHA)'
          })
        }

        return JSON.stringify({ data: { web: results } })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || 'Web search failed' })
      }
    }
  })

  // 8. web_extract
  const webExtractSchema: ToolSchema = {
    name: 'web_extract',
    description: 'Extract content from web page URLs. Returns clean markdown/text content.',
    parameters: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string', description: 'URL to extract' },
          description: 'List of URLs to extract content from'
        },
        char_limit: { type: 'integer', description: 'Max character budget per page (default: 15000)' }
      },
      required: ['urls']
    }
  }

  registry.register({
    name: 'web_extract',
    schema: webExtractSchema,
    toolset: 'web',
    parallelSafe: true,
    handler: async (args, context) => {
      const urls = Array.isArray(args.urls) ? args.urls.map(String) : []
      const charLimit = Math.min(50_000, Number(args.char_limit) || 15_000)
      const results: Array<{ url: string; title: string; content: string; error?: string }> = []

      for (const targetUrl of urls.slice(0, 5)) {
        try {
          let currentUrl = targetUrl
        let redirectCount = 0
        const maxRedirects = 5
        let res: any = null
        let fetchError: string | null = null

        while (true) {
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 30000)

            try {
              res = await fetchSafeUrl(currentUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                signal: controller.signal, timeoutMs: 30000, maxBytes: 5 * 1024 * 1024,
                requester: context?.httpRequester
              })
            } finally {
              clearTimeout(timeoutId)
            }
          } catch (err: any) {
            fetchError = err.message || String(err)
            break
          }

          if (res && [301, 302, 303, 307, 308].includes(res.status)) {
            const location = res.headers?.get ? res.headers.get('location') : res.headers?.location
            if (!location) {
              fetchError = `HTTP ${res.status}: Redirect with no Location header`
              break
            }
            redirectCount++
            if (redirectCount > maxRedirects) {
              fetchError = 'Too many redirects'
              break
            }
            res.body?.resume?.()
            currentUrl = new URL(location, currentUrl).toString()
            continue
          }

          break
        }

        if (fetchError) {
          results.push({
            url: targetUrl,
            title: 'Blocked',
            content: '',
            error: fetchError
          })
          continue
        }

        if (!res || !res.ok) {
          results.push({
            url: targetUrl,
            title: targetUrl,
            content: '',
            error: res ? `HTTP ${res.status}: ${res.statusText || ''}` : 'Fetch failed'
          })
          continue
        }

        let rawHtml = ''
        try {
          rawHtml = await res.text()
        } catch (err: any) {
          results.push({
            url: targetUrl,
            title: targetUrl,
            content: '',
            error: `Failed to read response body: ${err.message}`
          })
          continue
        }

        if (rawHtml.length > 5 * 1024 * 1024) {
          rawHtml = rawHtml.slice(0, 5 * 1024 * 1024)
        }

        const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
        const title = titleMatch ? titleMatch[1].trim() : targetUrl

          let clean = rawHtml
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
            .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
            .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n### $1\n')
            .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
            .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n\s*\n+/g, '\n\n')
            .trim()

          if (clean.length > charLimit) {
            clean = clean.slice(0, charLimit) + `\n\n[... Truncated at ${charLimit} chars ...]`
          }

          results.push({ url: targetUrl, title, content: clean })
        } catch (err: any) {
          results.push({ url: targetUrl, title: targetUrl, content: '', error: err.message || 'Extract failed' })
        }
      }

      return JSON.stringify({ results })
    }
  })

  // 9. clarify
  const clarifySchema: ToolSchema = {
    name: 'clarify',
    description: 'Ask the user one or more questions when you need a decision, clarification, or feedback before proceeding.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'Question text' },
              choices: { type: 'array', items: { type: 'string' }, description: 'Predefined choices (recommended first)' },
              multi_select: { type: 'boolean', description: 'Allow multiple selections' }
            },
            required: ['question']
          },
          description: 'Questions to ask the user'
        }
      },
      required: ['questions']
    }
  }

  registry.register({
    name: 'clarify',
    schema: clarifySchema,
    toolset: 'clarify',
    handler: async (args) => {
      const questions = Array.isArray(args.questions) ? args.questions : []
      const responses: Array<{ question: string; choices_offered?: string[]; status: string }> = []

      for (const q of questions) {
        responses.push({
          question: q.question,
          choices_offered: q.choices,
          status: 'clarification_requested'
        })
      }

      return JSON.stringify({
        clarification_needed: true,
        responses,
        message: 'This runtime cannot collect structured clarification answers. Ask these questions directly in the final response and wait for the user before proceeding.'
      })
    }
  })

  // 10. memory
  const memorySchema: ToolSchema = {
    name: 'memory',
    description: 'Save durable facts to persistent memory (MEMORY.md = notes/lessons, USER.md = user profile) that survive across sessions.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'replace', 'remove'], description: 'Action to perform' },
        target: { type: 'string', enum: ['memory', 'user'], description: 'Which store: memory for personal notes, user for user profile' },
        content: { type: 'string', description: 'Entry content for add/replace' },
        old_text: { type: 'string', description: 'Unique substring identifying existing entry to replace/remove' },
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'replace', 'remove'] },
              target: { type: 'string', enum: ['memory', 'user'] },
              content: { type: 'string' },
              new_text: { type: 'string' },
              old_text: { type: 'string' }
            },
            required: ['action']
          },
          description: 'Batch operations array'
        }
      },
      required: ['target']
    }
  }

  registry.register({
    name: 'memory',
    schema: memorySchema,
    toolset: 'memory',
    handler: async (args, context) => {
      const mem = context?.stores?.memory || memory
      const target = (args.target || 'memory') as 'memory' | 'user'

      if (Array.isArray(args.operations) && args.operations.length > 0) {
        const res = await mem.batch(args.operations, target)
        return JSON.stringify(res)
      }

      const action = String(args.action || 'add')
      const content = String(args.content || args.new_text || '')
      const oldText = String(args.old_text || '')

      if (action === 'add') {
        return JSON.stringify(await mem.add(target, content))
      } else if (action === 'replace') {
        return JSON.stringify(await mem.replace(target, oldText, content))
      } else if (action === 'remove') {
        return JSON.stringify(await mem.remove(target, oldText))
      }

      return JSON.stringify({ error: `Unknown memory action: ${action}` })
    }
  })

  // 11. todo_list
  const todoListSchema: ToolSchema = {
    name: 'todo_list',
    description: 'Track and manage task list for multi-step work. Pass todos to update/merge; omit to read active todos.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Task ID' },
              content: { type: 'string', description: 'Task description' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] }
            },
            required: ['id']
          },
          description: 'Task entries to write or merge'
        },
        merge: { type: 'boolean', description: 'Merge with existing items instead of replacing (default: false)' }
      }
    }
  }

  registry.register({
    name: 'todo_list',
    schema: todoListSchema,
    toolset: 'todo',
    handler: async (args, context) => {
      const td = context?.stores?.todo || todo
      if (Array.isArray(args.todos)) {
        const updated = td.write(args.todos, isTruthy(args.merge))
        return JSON.stringify({ todos: updated, active_count: updated.filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled').length })
      }
      return JSON.stringify({ todos: td.read() })
    }
  })

  // 12. image_generate
  const imageGenerateSchema: ToolSchema = {
    name: 'image_generate',
    description: 'Generate images from visual text prompt. Saves generated image to disk and returns path.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image description prompt' },
        aspect_ratio: { type: 'string', description: "Aspect ratio (e.g. '1:1', '16:9', '9:16', '4:3')" },
        output_path: { type: 'string', description: 'Optional local destination path' }
      },
      required: ['prompt']
    }
  }

  registry.register({
    name: 'image_generate',
    schema: imageGenerateSchema,
    toolset: 'image_gen',
    handler: async (args, context, signal) => {
      const prompt = String(args.prompt || '').trim()
      if (!prompt) return JSON.stringify({ error: 'Prompt is required' })

      const outDir = join(getVallenatrixHome(), 'images')
      mkdirSync(outDir, { recursive: true })
      let requestedPath = String(args.output_path || '')
      if (requestedPath.startsWith('~/')) requestedPath = join(homedir(), requestedPath.slice(2))
      let targetFile = requestedPath
        ? resolve(context.workingDir || process.cwd(), requestedPath)
        : join(outDir, `img_${Date.now()}`)

      try {
        let width = 1024
        let height = 1024
        if (args.aspect_ratio === '16:9') { width = 1280; height = 720 }
        else if (args.aspect_ratio === '9:16') { width = 720; height = 1280 }
        else if (args.aspect_ratio === '4:3') { width = 1024; height = 768 }

        const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true`
        const controller = new AbortController()
        const abort = () => controller.abort()
        const timer = setTimeout(abort, 120_000)
        if (signal?.aborted) abort()
        else signal?.addEventListener('abort', abort, { once: true })
        let res: Response
        let buf: Buffer
        try {
          res = await fetch(pollUrl, { signal: controller.signal })
          if (!res.ok) throw new Error(`Pollinations HTTP error: ${res.status}`)
          buf = Buffer.from(await res.arrayBuffer())
        } finally {
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
        }

        // Detect real image format from magic bytes; reject non-image error pages.
        let realExt: string | undefined
        if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xD8) {
          realExt = 'jpg'
        } else if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
          realExt = 'png'
        } else if (buf.length >= 4 && buf.slice(0, 4).toString() === 'RIFF') {
          realExt = 'webp'
        }
        if (!realExt) throw new Error(`Pollinations response is not a supported image (content-type: ${res.headers.get('content-type') || 'unknown'})`)

        let finalPath = targetFile
        const ext = realExt === 'jpg' ? '.jpg' : `.${realExt}`
        if (!/\.(?:png|jpe?g|webp)$/i.test(finalPath)) finalPath += ext
        else if (!finalPath.toLowerCase().endsWith(ext)) finalPath = finalPath.replace(/\.(?:png|jpe?g|webp)$/i, ext)

        mkdirSync(dirname(finalPath), { recursive: true })
        writeFileSync(finalPath, buf)

        return JSON.stringify({
          success: true,
          path: finalPath,
          bytes: buf.length,
          url: pollUrl,
          message: `Image generated and saved to ${finalPath}`
        })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || 'Image generation failed' })
      }
    }
  })

  // 13. vision_analyze
  const visionAnalyzeSchema: ToolSchema = {
    name: 'vision_analyze',
    description: 'Analyze images and photos using AI vision. Supports local image paths (PNG, JPEG, WebP, GIF) or web URLs. Call it any time the user references an image or photo — then answer from what you see.',
    parameters: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'Image URL (http/https), local file path, or data: URL to analyze' },
        question: { type: 'string', description: 'Your question or request about the image (e.g. describe contents, read text, identify errors)' }
      },
      required: ['image_url', 'question']
    }
  }

  registry.register({
    name: 'vision_analyze',
    schema: visionAnalyzeSchema,
    toolset: 'vision',
    parallelSafe: true,
    handler: async (args, context) => {
      const rawInput = String(args.image_url || '').trim()
      const question = String(args.question || 'Describe this image in detail and answer any user questions.').trim()

      if (!rawInput) {
        return JSON.stringify({ error: 'image_url parameter is required' })
      }

      let dataUrl = ''

      if (rawInput.startsWith('data:image/')) {
        dataUrl = rawInput
      } else if (rawInput.startsWith('http://') || rawInput.startsWith('https://')) {
        try {
          let currentUrl = rawInput
          let res: any
          for (let redirects = 0; ; redirects++) {
            const parsed = new URL(currentUrl)
            res = await fetchSafeUrl(currentUrl, { signal: AbortSignal.timeout(20000), timeoutMs: 20000, maxBytes: 10 * 1024 * 1024, requester: context?.httpRequester })
            if (![301, 302, 303, 307, 308].includes(res.status)) break
            if (redirects >= 5) throw new Error('Too many redirects')
            const location = res.headers?.get?.('location')
            if (!location) throw new Error('Redirect with no Location header')
            res.body?.resume?.()
            currentUrl = new URL(location, parsed).toString()
          }
          if (!res.ok) {
            return JSON.stringify({ error: `Failed to fetch image URL: HTTP ${res.status} ${res.statusText}` })
          }
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of res.body as any) {
            const part = Buffer.from(chunk)
            size += part.length
            if (size > 10 * 1024 * 1024) { res.body?.destroy?.(); res.body?.cancel?.(); throw new Error('Image exceeds 10MB limit') }
            chunks.push(part)
          }
          const buf = Buffer.concat(chunks)
          let mime = res.headers.get('content-type') || 'image/png'
          if (buf[0] === 0xFF && buf[1] === 0xD8) mime = 'image/jpeg'
          else if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png'
          else if (buf.slice(0, 4).toString() === 'RIFF') mime = 'image/webp'
          dataUrl = `data:${mime};base64,${buf.toString('base64')}`
        } catch (err: any) {
          return JSON.stringify({ error: `Cannot fetch image URL: ${err.message}` })
        }
      } else {
        // Local file
        let filePath = rawInput
        if (filePath.startsWith('~/')) {
          filePath = join(homedir(), filePath.slice(2))
        }
        const fullPath = isAbsolute(filePath) ? filePath : resolve(context?.workingDir || process.cwd(), filePath)

        if (!existsSync(fullPath)) {
          return JSON.stringify({ error: `Image file not found: ${filePath}` })
        }

        try {
          const st = statSync(fullPath)
          if (!st.isFile()) {
            return JSON.stringify({ error: `Not a regular file: ${filePath}` })
          }
          if (st.size > 20 * 1024 * 1024) {
            return JSON.stringify({ error: `Image file too large: ${(st.size / 1024 / 1024).toFixed(1)} MB (max 20 MB)` })
          }

          const buf = readFileSync(fullPath)
          let mime = 'image/png'
          if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xD8) {
            mime = 'image/jpeg'
          } else if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
            mime = 'image/png'
          } else if (buf.length >= 4 && buf.slice(0, 4).toString() === 'RIFF') {
            mime = 'image/webp'
          } else if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
            mime = 'image/gif'
          } else if (fullPath.toLowerCase().endsWith('.svg')) {
            mime = 'image/svg+xml'
          }

          dataUrl = `data:${mime};base64,${buf.toString('base64')}`
        } catch (err: any) {
          return JSON.stringify({ error: `Cannot read image file: ${err.message}` })
        }
      }

      // Query vision model via active provider
      try {
        let providerCfg: { name?: string; base_url: string; api_key: string; model: string }
        try {
          providerCfg = context?.providerConfig || getActiveProvider(loadConfig()) as any
        } catch {
          providerCfg = {
            name: '9router',
            base_url: 'http://127.0.0.1:20128/v1',
            api_key: '',
            model: 'ag/gemini-3.8-flash-medium'
          }
        }
        const baseURL = (providerCfg.base_url || 'http://127.0.0.1:20128/v1').replace('://localhost:', '://127.0.0.1:')
        const model = providerCfg.model || 'ag/gemini-3.8-flash-medium'
        const apiKey = providerCfg.api_key || ''

        const visionResponse = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: question },
                  { type: 'image_url', image_url: { url: dataUrl } }
                ]
              }
            ],
            stream: false,
            max_tokens: 2048
          }),
          signal: AbortSignal.timeout(60000)
        })

        if (!visionResponse.ok) {
          const errBody = await visionResponse.text()
          return JSON.stringify({
            error: `Vision model HTTP error ${visionResponse.status}: ${errBody.slice(0, 300)}`
          })
        }

        const rawText = await visionResponse.text()
        let textAnswer = ''
        if (rawText.trim().startsWith('data:')) {
          for (const line of rawText.split('\n')) {
            const trimmed = line.trim()
            if (trimmed.startsWith('data:') && trimmed !== 'data: [DONE]') {
              try {
                const chunk = JSON.parse(trimmed.slice(5).trim())
                const delta = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content || ''
                textAnswer += delta
              } catch {}
            }
          }
        } else {
          try {
            const data = JSON.parse(rawText)
            textAnswer = data.choices?.[0]?.message?.content || '(Vision model returned empty answer)'
          } catch {
            textAnswer = rawText
          }
        }

        return JSON.stringify({
          analysis: textAnswer.trim() || '(Vision model returned empty answer)',
          image: rawInput
        })
      } catch (err: any) {
        return JSON.stringify({
          error: `Vision analysis request failed: ${err.message}`
        })
      }
    }
  })

  // 13. browser_exec
  const browserExecSchema: ToolSchema = {
    name: 'browser_exec',
    description: 'Run Python browser automation subprocess. `session` is unsupported and rejected; returns stdout and screenshot paths.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python browser automation code' },
        session: { type: 'string', description: 'Named browser session' },
        timeout_s: { type: 'integer', description: 'Timeout in seconds (default: 300)' }
      },
      required: ['code']
    }
  }

  registry.register({
    name: 'browser_exec',
    schema: browserExecSchema,
    toolset: 'browser-use',
    handler: async (args, context, signal) => {
      if (args.session) return JSON.stringify({ exit_code: 1, output: '', error: 'Named browser sessions are not supported by this runtime.' })
      const code = String(args.code || '')
      const workdir = context.workingDir || process.cwd()
      const timeout = (Number(args.timeout_s) || 300) * 1000

      return new Promise<string>((resolveResult) => {
        let child: any = null
        let tempDir: string | undefined
        let settled = false
        let timedOut = false
        let timeoutTimer: NodeJS.Timeout | undefined
        const abortChild = () => { try { if (child?.pid) process.kill(-child.pid, 'SIGKILL') } catch { try { child?.kill?.('SIGKILL') } catch {} } }
        const argsList = ['-c', code]
        if (Buffer.byteLength(code) > 100_000) {
          try {
            tempDir = mkdtempSync(join(tmpdir(), 'vallenatrix-browser-'))
            writeFileSync(join(tempDir, 'script.py'), code, { mode: 0o600 })
            argsList.splice(0, argsList.length, join(tempDir, 'script.py'))
          } catch (err: any) {
            return resolveResult(JSON.stringify({ exit_code: 1, output: '', error: `Could not stage code: ${err.message}` }))
          }
        }
        const finish = (result: string) => {
          if (settled) return
          settled = true
          if (timeoutTimer) clearTimeout(timeoutTimer)
          signal?.removeEventListener('abort', abortChild)
          if (tempDir) { try { rmSync(tempDir, { recursive: true, force: true }) } catch {} }
          resolveResult(result)
        }
        const stdoutParts: Buffer[] = []
        const stderrParts: Buffer[] = []
        let capturedBytes = 0
        let bufferExceeded = false
        const collect = (parts: Buffer[]) => (chunk: Buffer) => {
          const available = 10 * 1024 * 1024 - capturedBytes
          if (available > 0) {
            const kept = chunk.subarray(0, available)
            parts.push(kept)
            capturedBytes += kept.length
          }
          if (chunk.length > available && !bufferExceeded) { bufferExceeded = true; abortChild() }
        }
        child = spawn('python3', argsList, { cwd: workdir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
        child.stdout.on('data', collect(stdoutParts))
        child.stderr.on('data', collect(stderrParts))
        child.on('close', (code: number | null, closeSignal: string | null) => {
          if (signal?.aborted) return finish(JSON.stringify({ exit_code: 130, output: '', error: 'Interrupted' }))
          const stdout = Buffer.concat(stdoutParts).toString()
          const stderr = Buffer.concat(stderrParts).toString()
          const rawOutput = (stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')).trim()
          const { text: output, truncated } = truncateOutput(rawOutput, 50_000)
          const exitCode = code ?? (closeSignal ? 128 : 1)
          let hint: string | undefined
          if (rawOutput.includes('No module named') || rawOutput.includes('not defined')) hint = 'Browser automation requires playwright. Use web_search and web_extract for web tasks.'
          const error = bufferExceeded ? 'Process output exceeded 10 MB' : timedOut ? 'Process timed out' : exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined
          finish(JSON.stringify({ exit_code: exitCode, stdout: output, truncated, timed_out: timedOut, hint, error }))
        })
        if (signal?.aborted) abortChild()
        else signal?.addEventListener('abort', abortChild, { once: true })
        timeoutTimer = setTimeout(() => { timedOut = true; abortChild() }, timeout)
        child.on('error', (err: any) => finish(JSON.stringify({ exit_code: 1, output: '', error: err.message || 'Process error' })))
      })
    }
  })

  // 14. manage_connections
  const manageConnectionsSchema: ToolSchema = {
    name: 'manage_connections',
    description: 'Check status of external connectors and services (9router API, local git repo, working tree).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'list'], default: 'status' }
      }
    }
  }

  registry.register({
    name: 'manage_connections',
    schema: manageConnectionsSchema,
    toolset: 'connections',
    handler: async (_args, context) => {
      const workdir = context?.workingDir || process.cwd()
      return JSON.stringify({
        supported: false,
        error: 'Hosted connectors are not integrated in this runtime.',
        local_environment: {
          home: homedir(),
          working_directory: workdir,
          git_repository: existsSync(join(workdir, '.git'))
        }
      })
    }
  })

  // 15. delegate_task (skip for subagents)
  if (!isSubagent) {
    const delegateTaskSchema: ToolSchema = {
      name: 'delegate_task',
      description: 'Spawn subagent in isolated context to complete focused subtasks. Returns summary.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                goal: { type: 'string', description: 'Goal for subagent' },
                context: { type: 'string', description: 'Background context for subagent' }
              },
              required: ['goal']
            },
            description: 'Subagent tasks to execute'
          }
        },
        required: ['tasks']
      }
    }

    registry.register({
      name: 'delegate_task',
      schema: delegateTaskSchema,
      toolset: 'delegation',
      handler: async (args, context) => {
        if (context?.isSubagent) {
          return JSON.stringify({ error: 'Subagents cannot call delegate_task (delegation depth limit reached).' })
        }
        const tasks = Array.isArray(args.tasks) ? args.tasks : []
        const summaries: Array<{ goal: string; summary: string }> = []
        const delegateFn = context?.delegateAgentFactory || delegateAgentFactory

        for (let start = 0; start < tasks.length; start += 3) {
          const batch = tasks.slice(start, start + 3)
          const results = await Promise.all(batch.map(async t => {
            if (!delegateFn) return { goal: t.goal, summary: `Subagent delegated task completed with goal: ${t.goal}` }
            try {
              const summary = await delegateFn(t.goal + (t.context ? `\nContext: ${t.context}` : ''))
              return { goal: t.goal, summary }
            } catch (err: any) {
              return { goal: t.goal, summary: `Subagent failed: ${err.message}` }
            }
          }))
          summaries.push(...results)
        }

        return JSON.stringify({ results: summaries })
      }
    })
  }

  // 17. skills_list
  const skillsListSchema: ToolSchema = {
    name: 'skills_list',
    description: 'List available modular skills with their name, category, and description. Use skill_view(name) to load full content.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category filter to narrow results' }
      }
    }
  }

  registry.register({
    name: 'skills_list',
    schema: skillsListSchema,
    toolset: 'skills',
    parallelSafe: true,
    handler: async (args, context) => {
      const loader = context?.stores?.skillLoader || (context as any)?.agent?.skillLoader || skillLoader
      if (!loader) {
        return JSON.stringify([])
      }
      const category = args.category ? String(args.category).trim() : undefined
      const skills = category ? loader.listByCategory(category) : loader.list()
      const list = skills.map((s: any) => ({
        name: s.name,
        description: s.metadata?.description || '',
        category: s.metadata?.category || 'general'
      }))
      return JSON.stringify(list)
    }
  })

  // 18. skill_view
  const skillViewSchema: ToolSchema = {
    name: 'skill_view',
    description: 'Load full instructions and content of a skill, or access its linked files (references, templates, scripts). First call returns SKILL.md content plus linked_files list. To access linked file, call with file_path parameter.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name (see skills_list to browse available skills)' },
        file_path: { type: 'string', description: 'Optional relative path to a linked file within the skill (e.g., references/api.md)' }
      },
      required: ['name']
    }
  }

  registry.register({
    name: 'skill_view',
    schema: skillViewSchema,
    toolset: 'skills',
    parallelSafe: true,
    handler: async (args, context) => {
      const loader = context?.stores?.skillLoader || (context as any)?.agent?.skillLoader || skillLoader
      const name = String(args.name || '').trim()
      if (!name) {
        return JSON.stringify({ error: 'Skill name is required' })
      }
      if (!loader) {
        return JSON.stringify({ error: 'Skill loader not available' })
      }
      const skill = loader.get(name)
      if (!skill) {
        return JSON.stringify({ error: `Skill '${name}' not found. Use skills_list to see available skills.` })
      }

      const filePath = args.file_path ? String(args.file_path).trim() : ''
      if (filePath) {
        const skillBaseDir = realpathSync(dirname(skill.path))
        const linkedFullPath = resolve(skillBaseDir, filePath)
        const relPath = relative(skillBaseDir, linkedFullPath)
        if (!relPath || relPath.startsWith(`..${sep}`) || relPath === '..' || isAbsolute(relPath)) {
          return JSON.stringify({ error: `Linked file '${filePath}' escapes skill directory` })
        }
        let cursor = skillBaseDir
        for (const part of relPath.split(sep)) {
          cursor = join(cursor, part)
          if (!existsSync(cursor)) break
          if (lstatSync(cursor).isSymbolicLink()) return JSON.stringify({ error: `Linked file '${filePath}' cannot traverse symlinks` })
        }
        if (!existsSync(linkedFullPath)) {
          return JSON.stringify({ error: `Linked file '${filePath}' not found in skill '${name}'` })
        }
        try {
          const content = readFileSync(linkedFullPath, 'utf-8')
          return JSON.stringify({ name: skill.name, file_path: filePath, content })
        } catch (err: any) {
          return JSON.stringify({ error: `Failed to read linked file: ${err.message}` })
        }
      }

      return JSON.stringify({
        name: skill.name,
        description: skill.metadata?.description || '',
        category: skill.metadata?.category || 'general',
        content: skill.content,
        linked_files: skill.linkedFiles || {}
      })
    }
  })

  // 19. skill_manage - Install/uninstall/update skills from hub
  const skillManageSchema: ToolSchema = {
    name: 'skill_manage',
    description: 'Manage skills: search hub, install from GitHub/official sources, uninstall, or update. User approval required for install operations.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'install', 'uninstall', 'update', 'list_installed'],
          description: 'Action: search (find skills), install (add skill), uninstall (remove), update (refresh), list_installed (show installed)'
        },
        query: {
          type: 'string',
          description: 'Search query (for action=search)'
        },
        identifier: {
          type: 'string',
          description: 'Skill identifier: GitHub URL, "official/category/name", or skill name'
        },
        name: {
          type: 'string',
          description: 'Skill name (for install override or uninstall/update)'
        },
        category: {
          type: 'string',
          description: 'Category for install (optional, e.g., "devops", "research")'
        },
        source: {
          type: 'string',
          description: 'Source filter for search: "official" or "github"'
        },
        operations: {
          type: 'array',
          description: 'Atomic batch operations: create, patch, delete, write_file, or remove_file',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create', 'patch', 'delete', 'write_file', 'remove_file'] },
              name: { type: 'string' },
              category: { type: 'string' },
              content: { type: 'string' },
              old_string: { type: 'string' },
              new_string: { type: 'string' },
              file_path: { type: 'string' }
            },
            required: ['action', 'name']
          }
        }
      },
    }
  }

  registry.register({
    name: 'skill_manage',
    schema: skillManageSchema,
    toolset: 'skills',
    handler: async (args, context) => {
      // Hermes-style atomic batch operations
      if (args.operations && Array.isArray(args.operations)) {
        const ops = args.operations
        const loader = context?.stores?.skillLoader || (context as any)?.agent?.skillLoader || skillLoader
        const targetBaseDir = (loader as any)?.skillPaths?.[0] || join(getVallenatrixHome(), 'skills')

        const results: any[] = []
        const undo: Array<() => void> = []
        const cleanupOnCommit: string[] = []
        const root = resolve(targetBaseDir)
        let failed: any = null
        for (let opIndex = 0; opIndex < ops.length; opIndex++) {
          const op = ops[opIndex]
          try {
          const opAction = String(op.action || '')
          const name = String(op.name || '').trim()
          if (!['create', 'patch', 'delete', 'write_file', 'remove_file'].includes(opAction)) throw new Error(`Unsupported operation '${opAction}'`)
          if (!name) throw new Error('Skill name is required for operation')

          if (opAction === 'create') {
            const category = validateCategory(op.category ? String(op.category).trim() : 'custom')
            const safeName = validateSkillName(name)
            const skillDir = resolve(root, category, safeName)
            const rel = relative(root, skillDir)
            if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Skill path escapes skills directory')
            if (existsSync(skillDir)) throw new Error('Skill already exists; refusing to overwrite')
            const parent = dirname(skillDir)
            if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error('Skill category cannot be a symlink')
            const dirsToRemove: string[] = []
            for (let dir = skillDir; dir !== root && !existsSync(dir); dir = dirname(dir)) dirsToRemove.push(dir)
            const skillPath = join(skillDir, 'SKILL.md')
            undo.push(() => { if (existsSync(skillPath)) unlinkSync(skillPath); for (const dir of dirsToRemove) { try { rmdirSync(dir) } catch {} } })
            mkdirSync(skillDir, { recursive: true })
            const content = String(op.content || `---\nname: ${safeName}\ndescription: Custom skill\ncategory: ${category}\n---\n# ${safeName}\n`)
            writeFileSync(skillPath, content, 'utf-8')
            results.push({ action: 'create', name: safeName, path: skillPath, status: 'created' })
          } else if (opAction === 'patch') {
            const skill = loader?.get(name)
            if (!skill) throw new Error(`Skill '${name}' not found for patch`)
            const before = readFileSync(skill.path)
            const mode = statSync(skill.path).mode & 0o7777
            const patched = fuzzyReplace(before.toString('utf-8'), op.old_string || '', op.new_string || '', false)
            undo.push(() => { writeFileSync(skill.path, before); chmodSync(skill.path, mode) })
            writeFileSync(skill.path, patched.content, 'utf-8')
            results.push({ action: 'patch', name, strategy: patched.strategy, status: 'patched' })
          } else if (opAction === 'delete') {
            const skill = loader?.get(name)
            if (!skill) throw new Error(`Skill '${name}' not found for delete`)
            const skillDir = resolve(dirname(skill.path))
            const rel = relative(root, skillDir)
            if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Skill path escapes skills directory')
            if (basename(skillDir) === 'skills' || lstatSync(skillDir).isSymbolicLink()) throw new Error('Refusing to delete invalid skill directory')
            const backupDir = mkdtempSync(join(root, '.skill-batch-'))
            const backupPath = join(backupDir, basename(skillDir))
            undo.push(() => { if (existsSync(backupPath)) renameSync(backupPath, skillDir) })
            cleanupOnCommit.push(backupDir)
            renameSync(skillDir, backupPath)
            results.push({ action: 'delete', name, status: 'deleted' })
          } else if (opAction === 'write_file') {
            const skill = loader?.get(name)
            if (!skill) throw new Error(`Skill '${name}' not found`)
            const skillDir = realpathSync(dirname(skill.path))
            const filePath = resolve(skillDir, String(op.file_path || ''))
            const rel = relative(skillDir, filePath)
            if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Skill file path escapes skill directory')
            let cursor = skillDir
            for (const part of rel.split(sep)) { cursor = join(cursor, part); if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error('Skill file path cannot traverse symlinks') }
            if (existsSync(filePath) && !lstatSync(filePath).isFile()) throw new Error('Skill file target must be a regular file')
            const existed = existsSync(filePath)
            const before = existed ? readFileSync(filePath) : null
            const mode = existed ? statSync(filePath).mode & 0o7777 : 0o600
            const dirsToRemove: string[] = []
            for (let dir = dirname(filePath); dir !== skillDir && !existsSync(dir); dir = dirname(dir)) dirsToRemove.push(dir)
            undo.push(() => {
              if (existed) { writeFileSync(filePath, before!); chmodSync(filePath, mode) }
              else if (existsSync(filePath)) unlinkSync(filePath)
              for (const dir of dirsToRemove) { try { rmdirSync(dir) } catch {} }
            })
            mkdirSync(dirname(filePath), { recursive: true })
            writeFileSync(filePath, String(op.content || ''), 'utf-8')
            results.push({ action: 'write_file', name, file_path: op.file_path, status: 'written' })
          } else if (opAction === 'remove_file') {
            const skill = loader?.get(name)
            if (!skill) throw new Error(`Skill '${name}' not found`)
            const skillDir = realpathSync(dirname(skill.path))
            const filePath = resolve(skillDir, String(op.file_path || ''))
            const rel = relative(skillDir, filePath)
            if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Skill file path escapes skill directory')
            let cursor = skillDir
            for (const part of rel.split(sep)) { cursor = join(cursor, part); if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error('Skill file path cannot traverse symlinks') }
            if (existsSync(filePath)) {
              if (!lstatSync(filePath).isFile()) throw new Error('Skill file target must be a regular file')
              const before = readFileSync(filePath)
              const mode = statSync(filePath).mode & 0o7777
              undo.push(() => { writeFileSync(filePath, before); chmodSync(filePath, mode) })
              unlinkSync(filePath)
            }
            results.push({ action: 'remove_file', name, file_path: op.file_path, status: 'removed' })
          }
          } catch (err: any) {
            failed = { action: op.action, name: op.name, status: 'error', error: err.message || String(err) }
            results.push(failed)
            break
          }
        }

        if (!failed) {
          try { loader?.load?.() }
          catch (err: any) { failed = { action: 'reload', status: 'error', error: err.message || String(err) }; results.push(failed) }
        }
        const rollbackErrors: string[] = []
        if (failed) {
          for (const rollback of undo.reverse()) {
            try { rollback() } catch (err: any) { rollbackErrors.push(err.message || String(err)) }
          }
          for (const result of results) if (result.status !== 'error') result.status = 'rolled_back'
          for (let i = results.length; i < ops.length; i++) results.push({ action: ops[i].action, name: ops[i].name, status: 'skipped' })
          try { loader?.load?.() } catch (err: any) { rollbackErrors.push(`Skill reload failed: ${err.message || String(err)}`) }
        } else {
          for (const dir of cleanupOnCommit) rmSync(dir, { recursive: true, force: true })
        }
        return JSON.stringify({ success: !failed, ...(failed ? { error: failed.error } : {}), ...(rollbackErrors.length ? { rollback_errors: rollbackErrors } : {}), message: `${failed ? 'Rolled back' : 'Applied'} ${ops.length} skill operations`, results })
      }

      const action = String(args.action || 'search')

      try {
        if (action === 'search') {
          const { searchSkills } = require('./skills_hub_search')
          const query = String(args.query || '')
          const source = args.source ? String(args.source) : undefined
          const results = await searchSkills({ query, source, limit: 20 })
          
          return JSON.stringify({
            action: 'search',
            query,
            results: results.map((r: any) => ({
              name: r.name,
              identifier: r.identifier,
              description: r.description,
              source: r.source,
              trust_level: r.trust_level,
              install_command: r.install_command
            }))
          })
        }

        if (action === 'list_installed') {
          const { listInstalledSkills } = require('./skills_hub_install')
          const installed = listInstalledSkills()
          
          return JSON.stringify({
            action: 'list_installed',
            skills: installed.map((s: any) => ({
              name: s.name,
              source: s.source,
              identifier: s.identifier,
              installed_at: s.installed_at,
              install_path: s.install_path
            }))
          })
        }

        if (action === 'install') {
          const identifier = String(args.identifier || '')
          if (!identifier) {
            return JSON.stringify({ error: 'Missing required field: identifier' })
          }

          // Parse identifier
          const { parseSkillIdentifier } = require('./skills_hub_models')
          const parsed = parseSkillIdentifier(identifier)

          // Fetch bundle
          const { fetchGitHubSkill, fetchOfficialSkill } = require('./skills_hub_search')
          let bundle

          if (parsed.source === 'github' && parsed.url) {
            bundle = await fetchGitHubSkill(parsed.url)
          } else if (parsed.source === 'official' && parsed.category) {
            bundle = await fetchOfficialSkill(parsed.category, parsed.name)
          } else {
            return JSON.stringify({ 
              error: `Unsupported identifier format: ${identifier}. Use GitHub URL or official/category/name` 
            })
          }

          // Quarantine
          const { quarantineBundle, installFromQuarantine } = require('./skills_hub_install')
          const quarantinePath = quarantineBundle(bundle)

          // Install with approval check
          const installOptions = {
            name: args.name ? String(args.name) : undefined,
            category: args.category ? String(args.category) : bundle.category,
            overwrite: false,
            skipScan: false
          }

          const result = installFromQuarantine(quarantinePath, bundle, installOptions)

          // Cleanup quarantine
          const { rmSync } = require('fs')
          rmSync(quarantinePath, { recursive: true, force: true })

          if (result.success) {
            // Reload skills
            const l = context?.stores?.skillLoader || (context as any)?.agent?.skillLoader || skillLoader
            l?.scanAll ? l.scanAll() : l?.load?.()
          }

          return JSON.stringify(result)
        }

        if (action === 'uninstall') {
          const name = String(args.name || '')
          if (!name) {
            return JSON.stringify({ error: 'Missing required field: name' })
          }

          const { uninstallSkill } = require('./skills_hub_install')
          const result = uninstallSkill(name)

          if (result.success) {
            // Reload skills
            const l = context?.stores?.skillLoader || (context as any)?.agent?.skillLoader || skillLoader
            l?.scanAll ? l.scanAll() : l?.load?.()
          }

          return JSON.stringify(result)
        }

        if (action === 'update') {
          const name = String(args.name || '')
          if (!name) {
            return JSON.stringify({ error: 'Missing required field: name' })
          }

          const { updateSkill } = require('./skills_hub_install')
          const result = await updateSkill(name)

          if (result.success) {
            // Reload skills
            const l = context?.stores?.skillLoader || (context as any)?.agent?.skillLoader || skillLoader
            l?.scanAll ? l.scanAll() : l?.load?.()
          }

          return JSON.stringify(result)
        }

        return JSON.stringify({ error: `Unknown action: ${action}` })
      } catch (err: any) {
        return JSON.stringify({ 
          error: err.message || 'Skill management operation failed',
          stack: err.stack
        })
      }
    }
  })

  const patchBatchSchema: ToolSchema = {
    name: 'patch_batch', description: 'Atomically apply targeted fuzzy replacements across multiple files. Preflights every file before writing.',
    parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'object', properties: {
      path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' }
    }, required: ['path', 'old_string', 'new_string'] } } }, required: ['files'] }
  }
  registry.register({ name: 'patch_batch', schema: patchBatchSchema, toolset: 'file', handler: async (args, context) =>
    JSON.stringify(applyPatchBatch(args.files, context.workingDir || process.cwd(), context))
  })

  const applyPatchSchema: ToolSchema = {
    name: 'apply_patch', description: 'Apply V4A multi-file patches with Update, Add, and Delete File sections; supports contextual @@ hunks.',
    parameters: { type: 'object', properties: { patch: { type: 'string' } }, required: ['patch'] }
  }
  registry.register({ name: 'apply_patch', schema: applyPatchSchema, toolset: 'file', handler: async (args, context) =>
    JSON.stringify(applyV4APatch(String(args.patch || ''), context.workingDir || process.cwd(), context))
  })

  const deferredTools = (context?: ToolContext) => registry.getDeferredTools(context?.toolWhitelist)
  registry.register({
    name: 'tool_search', toolset: 'core',
    schema: { name: 'tool_search', description: 'Find deferred tools by name or capability. Call tool_describe before tool_call.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    handler: async (args, context) => {
      const query = String(args.query || '').toLowerCase().trim()
      if (!query) return JSON.stringify({ error: 'query is required' })
      const words = query.split(/\s+/).filter(Boolean)
      const results = deferredTools(context).map(tool => ({
        name: tool.name, description: tool.schema.description,
        score: words.filter(word => `${tool.name} ${tool.schema.description}`.toLowerCase().includes(word)).length
      })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 10)
      return JSON.stringify({ results: results.map(({ score: _score, ...item }) => item) })
    }
  })
  registry.register({
    name: 'tool_describe', toolset: 'core',
    schema: { name: 'tool_describe', description: 'Return full schema for one deferred tool.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    handler: async (args, context) => {
      const tool = deferredTools(context).find(item => item.name === args.name)
      return tool ? JSON.stringify(tool.schema) : JSON.stringify({ error: 'Deferred tool not found or unavailable' })
    }
  })
  registry.register({
    name: 'tool_call', toolset: 'core',
    schema: { name: 'tool_call', description: 'Execute a deferred tool after tool_search and tool_describe.', parameters: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name', 'arguments'] } },
    handler: async () => JSON.stringify({ error: 'tool_call must be dispatched by the agent runtime' })
  })
}

function applyV4APatch(text: string, baseDir: string, context: ToolContext): Record<string, unknown> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '*** Begin Patch' || lines[lines.length - 1] !== '*** End Patch') return { error: 'Invalid V4A patch envelope' }
  type V4AEdit = { path: string; operation: 'update' | 'add' | 'delete'; original?: string; current?: string }
  const edits = new Map<string, V4AEdit>()
  let active: V4AEdit | null = null
  let hunk: string[] = []
  const applyHunk = () => {
    if (!active || !hunk.length) return
    if (active.operation !== 'update') throw new Error('Only Update File sections may contain @@ hunks')
    const oldLines: string[] = []
    const newLines: string[] = []
    for (const line of hunk) {
      if (line.startsWith(' ') || line.startsWith('-')) oldLines.push(line.slice(1))
      if (line.startsWith(' ') || line.startsWith('+')) newLines.push(line.slice(1))
    }
    const fileLines = (active.current || '').split('\n')
    let matches = -1
    for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
      if (oldLines.every((line, j) => fileLines[i + j] === line)) {
        if (matches !== -1) throw new Error('Patch hunk matches more than once; add context lines')
        matches = i
      }
    }
    if (matches < 0) throw new Error('Patch hunk context not found')
    fileLines.splice(matches, oldLines.length, ...newLines)
    active.current = fileLines.join('\n')
    hunk = []
  }
  const finalize = () => { applyHunk(); active = null }
  try {
    for (let i = 1; i < lines.length - 1; i++) {
      const line = lines[i]
      const header = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line)
      if (header) {
        finalize()
        let rawPath = header[2]
        if (rawPath.startsWith('~/')) rawPath = join(homedir(), rawPath.slice(2))
        const path = isAbsolute(rawPath) ? rawPath : resolve(baseDir, rawPath)
        if (edits.has(path)) throw new Error(`Duplicate file section: ${rawPath}`)
        const operation = header[1].toLowerCase() as V4AEdit['operation']
        active = { path, operation }
        if (operation !== 'add') {
          const original = readFileSync(path, 'utf8')
          active.original = original
          if (operation === 'update') active.current = original
        }
        edits.set(path, active)
      } else if (line === '*** End of File') {
        continue
      } else if (line.startsWith('@@')) {
        if (!active || active.operation !== 'update') throw new Error('Unexpected @@ outside Update File section')
        applyHunk()
      } else {
        if (!active) throw new Error(`Unexpected patch line: ${line}`)
        if (active.operation === 'add') {
          if (!line.startsWith('+')) throw new Error('Add File contents must use + lines')
          active.current = active.current === undefined ? line.slice(1) : `${active.current}\n${line.slice(1)}`
        } else if (active.operation === 'update') {
          if (![' ', '+', '-'].includes(line[0])) throw new Error(`Invalid hunk line: ${line}`)
          hunk.push(line)
        } else {
          throw new Error('Delete File section cannot contain content')
        }
      }
    }
    finalize()
    if (!edits.size) return { error: 'Patch contains no file operations' }
    const files = [...edits.values()].map(edit => ({ path: edit.path, operation: edit.operation, old_string: edit.original, new_string: edit.current }))
    const result = applyPatchBatch(files, baseDir, context)
    if (!result.success) return result
    const diffs = [...edits.values()].map(edit => {
      const path = relative(baseDir, edit.path) || basename(edit.path)
      const header = `--- ${path}\n+++ ${path}`
      if (edit.operation === 'delete') return `${header}\n-${(edit.original || '').replace(/\n$/, '').replace(/\n/g, '\n-')}`
      if (edit.operation === 'add') return `${header}\n+${(edit.current || '').replace(/\n$/, '').replace(/\n/g, '\n+')}`
      return `${header}\n${generateDiff(edit.original || '', edit.current || '')}`
    })
    const diff = diffs.join('\n')
    const maxChars = 20_000
    if (diff.length > maxChars) return { ...result, diff: `${diff.slice(0, maxChars)}\n... diff truncated`, diff_truncated: true }
    return { ...result, diff }
  } catch (err: any) {
    return { error: err.message || 'V4A patch failed; no files were changed.' }
  }
}

function applyPatchBatch(files: any, baseDir: string, context: ToolContext): Record<string, unknown> {
  if (!Array.isArray(files) || files.length < 1 || files.length > 20) return { error: 'files must contain 1–20 edits' }
  type StagedEdit = { path: string; temp: string; backup: string; operation: 'update' | 'add' | 'delete'; before: Buffer | null; after: string | null; mode: number; diff: string; originalMoved: boolean; newInstalled: boolean }
  const seen = new Set<string>()
  const staged: StagedEdit[] = []
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    for (let i = 0; i < files.length; i++) {
      const edit = files[i]
      let rawPath = String(edit.path || '')
      if (rawPath.startsWith('~/')) rawPath = join(homedir(), rawPath.slice(2))
      const path = isAbsolute(rawPath) ? rawPath : resolve(baseDir, rawPath)
      if (seen.has(path)) throw new Error(`Duplicate path in batch: ${rawPath}`)
      seen.add(path)
      const operation = (edit.operation || 'update') as StagedEdit['operation']
      if (!['update', 'add', 'delete'].includes(operation)) throw new Error(`Unsupported file operation: ${operation}`)
      const temp = `${path}.batch-${suffix}-${i}.tmp`
      const backup = `${path}.batch-${suffix}-${i}.original`
      if (operation === 'add') {
        try { lstatSync(path); throw new Error(`Add File target already exists: ${rawPath}`) }
        catch (err: any) { if (err.code !== 'ENOENT') throw err }
        if (!statSync(dirname(path)).isDirectory()) throw new Error(`Parent directory is not a directory: ${dirname(path)}`)
        const after = String(edit.new_string ?? '')
        staged.push({ path, temp, backup, operation, before: null, after, mode: 0o666 & ~process.umask(), diff: `+++ ${rawPath}\n${after}`, originalMoved: false, newInstalled: false })
        continue
      }
      const info = lstatSync(path)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Refusing non-regular file: ${rawPath}`)
      if (info.size > 10 * 1024 * 1024) throw new Error(`Refusing file over 10 MB: ${rawPath}`)
      const before = readFileSync(path)
      if (before.includes(0)) throw new Error(`Cannot patch binary file: ${rawPath}`)
      const oldText = before.toString('utf8')
      if (operation === 'delete') {
        staged.push({ path, temp, backup, operation, before, after: null, mode: info.mode & 0o7777, diff: `--- ${rawPath}\n(deleted)`, originalMoved: false, newInstalled: false })
      } else {
        const result = fuzzyReplace(oldText, String(edit.old_string ?? ''), String(edit.new_string ?? ''), isTruthy(edit.replace_all))
        staged.push({ path, temp, backup, operation, before, after: result.content, mode: info.mode & 0o7777, diff: result.diff, originalMoved: false, newInstalled: false })
      }
    }
    for (const item of staged) {
      if (item.after === null) continue
      writeFileSync(item.temp, item.after, { encoding: 'utf8', mode: item.mode })
      chmodSync(item.temp, item.mode)
    }
    try {
      for (const item of staged) {
        if (item.before !== null) { renameSync(item.path, item.backup); item.originalMoved = true }
        if (item.after !== null) { renameSync(item.temp, item.path); item.newInstalled = true }
      }
    } catch (err) {
      for (const item of [...staged].reverse()) {
        if (item.newInstalled) try { unlinkSync(item.path) } catch {}
        if (item.originalMoved) try { renameSync(item.backup, item.path) } catch {}
      }
      throw err
    }
    for (const item of staged) {
      if (item.originalMoved) try { unlinkSync(item.backup) } catch {}
      if (item.after !== null) recordWrittenFile(context, item.path, item.after)
    }
    return { success: true, files: staged.map(item => ({ path: item.path, operation: item.operation })) }
  } catch (err: any) {
    for (const item of staged) {
      try { unlinkSync(item.temp) } catch {}
      if (item.originalMoved && existsSync(item.backup) && !existsSync(item.path)) try { renameSync(item.backup, item.path) } catch {}
    }
    return { error: err.message || 'Batch patch failed; no files were changed.' }
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}
