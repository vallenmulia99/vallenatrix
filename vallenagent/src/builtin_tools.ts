import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs'
import { resolve, join, dirname, relative, isAbsolute } from 'path'
import { exec, execFile, spawn } from 'child_process'
import { homedir } from 'os'
import { getVallenatrixHome, loadConfig, getActiveProvider } from './config'
import { registry, ToolSchema } from './tools'
import { SkillLoader } from './skills'
import { MemoryStore } from './memory'
import { TodoStore } from './todo'

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
  if (replaceAll) {
    const parts = content.split(block)
    return parts.join(newString)
  }
  const idx = content.indexOf(block)
  if (idx === -1) return content
  return content.slice(0, idx) + newString + content.slice(idx + block.length)
}

function toExitCode(err: any): number {
  if (err == null) return 0
  if (typeof err.code === 'number') return err.code
  if (err.killed || err.signal) return 124
  return 1
}

function unescapeString(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
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
    const updated = applyReplace(content, matchedBlock, newString, replaceAll)
    return { content: updated, diff: generateDiff(matchedBlock, newString), strategy: 'indentation_flexible' }
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
    
    // Build character-level mapping from normalized to original indices
    const origIndex: number[] = []
    let origPos = 0
    for (let i = 0; i < content.length; i++) {
      origIndex.push(origPos)
      const char = content[i]
      const normalized = normalizeUnicode(char)
      origPos += normalized.length
    }
    origIndex.push(origPos) // end sentinel
    
    // Find match position in normalized content
    const normIdx = normContentUnicode.indexOf(normOldUnicode)
    
    // Map back to original indices
    let origStart = 0
    let normCount = 0
    for (let i = 0; i < content.length && normCount < normIdx; i++) {
      origStart = i + 1
      normCount += normalizeUnicode(content[i]).length
    }
    
    let origEnd = origStart
    normCount = 0
    for (let i = origStart; i < content.length && normCount < normOldUnicode.length; i++) {
      origEnd = i + 1
      normCount += normalizeUnicode(content[i]).length
    }
    
    const matchedBlock = content.slice(origStart, origEnd)
    const updated = content.slice(0, origStart) + newString + content.slice(origEnd)
    return { content: updated, diff: generateDiff(matchedBlock, newString), strategy: 'unicode_normalized' }
  }

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

  throw new Error(`Failed to find unique match for replacement after trying 9 matching strategies. Verify old_string exists in file.`)
}

function generateDiff(oldStr: string, newStr: string): string {
  const o = oldStr.split('\n').map(l => `-${l}`).join('\n')
  const n = newStr.split('\n').map(l => `+${l}`).join('\n')
  return `@@ -1,${oldStr.split('\n').length} +1,${newStr.split('\n').length} @@\n${o}\n${n}`
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
  const head = buf.subarray(0, headBytes).toString('utf-8')
  const tail = buf.subarray(buf.length - tailBytes).toString('utf-8')

  let spillPath: string | undefined
  try {
    const scratchDir = join(homedir(), '.vallenatrix', 'scratch')
    mkdirSync(scratchDir, { recursive: true })
    const digest = Buffer.from(text.slice(0, 100)).toString('hex').slice(0, 8)
    spillPath = join(scratchDir, `output-${Date.now()}-${digest}.log`)
    writeFileSync(spillPath, text, 'utf-8')
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
  skillLoader: SkillLoader,
  memoryStore?: MemoryStore,
  todoStore?: TodoStore,
  delegateAgentFactory?: (goal: string) => Promise<string>,
  isSubagent: boolean = false
): void {
  const memory = memoryStore || new MemoryStore()
  const todo = todoStore || new TodoStore()

  // 1. read_file
  const readFileSchema: ToolSchema = {
    name: 'read_file',
    description: "Read a text file with line numbers and pagination. Use this instead of cat/head/tail in terminal. Output format: 'LINE_NUM|CONTENT'. Use offset and limit for large files.",
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
        const fd = require('fs').openSync(fullPath, 'r')
        const buffer = Buffer.alloc(8192)
        const bytesRead = require('fs').readSync(fd, buffer, 0, 8192, 0)
        require('fs').closeSync(fd)
        
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
        const limit = Math.min(2000, Number(args.limit) || 2000)

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
    description: "Write content to a file, completely replacing existing content. Creates parent directories automatically. OVERWRITES the entire file — use 'patch' for targeted edits.",
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

      try {
        mkdirSync(dirname(fullPath), { recursive: true })
        writeFileSync(fullPath, content, 'utf-8')
        return JSON.stringify({
          success: true,
          path: fullPath,
          bytes_written: Buffer.byteLength(content, 'utf-8'),
          verified: true
        })
      } catch (err: any) {
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
        const content = readFileSync(fullPath, 'utf-8')
        const oldString = String(args.old_string ?? '')
        const newString = String(args.new_string ?? '')
        const replaceAll = isTruthy(args.replace_all)

        const result = fuzzyReplace(content, oldString, newString, replaceAll)
        writeFileSync(fullPath, result.content, 'utf-8')

        return JSON.stringify({
          success: true,
          path: fullPath,
          strategy: result.strategy,
          diff: result.diff
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
    handler: async (args, context) => {
      const basePath = context.workingDir || process.cwd()
      let searchDir = String(args.path || '.')
      if (searchDir.startsWith('~/')) {
        searchDir = join(homedir(), searchDir.slice(2))
      }
      const fullSearchDir = isAbsolute(searchDir) ? searchDir : resolve(basePath, searchDir)
      const target = (args.target || 'content') as 'content' | 'files'
      const pattern = String(args.pattern || '')
      const limit = Math.min(200, Number(args.limit) || 50)
      const offset = Math.max(0, Number(args.offset) || 0)

      if (!existsSync(fullSearchDir)) {
        return JSON.stringify({ error: `Directory not found: ${searchDir}` })
      }

      if (target === 'files') {
        const foundFiles: string[] = []
        const regex = globToRegex(pattern)

        function walk(dir: string) {
          if (foundFiles.length >= offset + limit) return
          try {
            const entries = readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
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

  // 5. terminal
  const terminalSchema: ToolSchema = {
    name: 'terminal',
    description: 'Execute shell commands on the host machine. Returns stdout, stderr, and exit code.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        workdir: { type: 'string', description: 'Working directory for this command' },
        timeout: { type: 'integer', description: 'Timeout in seconds (default: 120)' }
      },
      required: ['command']
    }
  }

  registry.register({
    name: 'terminal',
    schema: terminalSchema,
    toolset: 'terminal',
    handler: async (args, context) => {
      const rawCommand = String(args.command || '').trim()
      const workdir = (args.workdir as string) || context.workingDir || process.cwd()
      const timeout = (Number(args.timeout) || 120) * 1000

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

      // Probe command to detect chained cd transitions
      const probeCommand = `${rawCommand}\n__RET=$?; printf '\n__VALLEN_CWD__=%s\n' "$(pwd)"; exit $__RET`

      return new Promise<string>((resolveResult) => {
        const proc = spawn('/bin/sh', ['-c', probeCommand], {
          cwd: workdir,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })

        let stdout = ''
        let stderr = ''
        let killed = false
        const MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10MB in-memory cap to prevent OOM
        let exceededBufferCap = false

        proc.stdout.on('data', (chunk: Buffer) => {
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
        proc.stderr.on('data', (chunk: Buffer) => {
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

        proc.on('close', (code: number | null, signal: string | null) => {
          clearTimeout(timeoutHandle)
          
          let output = stdout || ''
          const cwdMarker = '\n__VALLEN_CWD__='
          const markerIdx = output.lastIndexOf(cwdMarker)
          if (markerIdx !== -1) {
            const detectedCwd = output.slice(markerIdx + cwdMarker.length).trim()
            output = output.slice(0, markerIdx)
            if (detectedCwd && existsSync(detectedCwd)) {
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
          if (killed || signal) {
            result.timed_out = true
            result.signal = signal || 'SIGKILL'
          }
          if (exitCode !== 0 && (code !== null || killed)) {
            result.error = killed ? 'Command timed out' : `Process exited with code ${code}`
          }
          resolveResult(JSON.stringify(result))
        })
      })
    }
  })

  // 6. execute_code
  const executeCodeSchema: ToolSchema = {
    name: 'execute_code',
    description: 'Execute Python code programmatically in a subprocess sandbox with stdlib and environment access. Stdout/stderr returned with head/tail truncation at 50KB.',
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
    handler: async (args, context) => {
      const code = String(args.code || '')
      const workdir = context.workingDir || process.cwd()
      const timeout = (Number(args.timeout_s) || 300) * 1000

      return new Promise<string>((resolveResult) => {
        execFile('python3', ['-c', code], { cwd: workdir, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          const rawOutput = (stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')).trim()
          const { text: output, truncated } = truncateOutput(rawOutput, 50_000)
          const exitCode = toExitCode(err)
          const result: any = {
            exit_code: exitCode,
            stdout: output,
            truncated
          }
          if (err?.killed || err?.signal) {
            result.timed_out = true
            result.signal = err.signal || 'SIGTERM'
          }
          if (err && exitCode !== 0) {
            result.error = err.message
          }
          resolveResult(JSON.stringify(result))
        })
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
    handler: async (args) => {
      const query = String(args.query || '').trim()
      const limit = Math.min(10, Math.max(1, Number(args.limit) || 5))

      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(15000)
        })
        if (!res.ok) {
          return JSON.stringify({
            error: `Search request failed with HTTP ${res.status}: ${res.statusText}`
          })
        }
        const html = await res.text()

        const results: Array<{ title: string; url: string; description: string }> = []
        const snippetMatches = [...html.matchAll(/<a class="result__snippet[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
        for (const m of snippetMatches.slice(0, limit)) {
          let rawUrl = m[1]
          if (rawUrl.includes('uddg=')) {
            const match = rawUrl.match(/uddg=([^&]+)/)
            if (match) rawUrl = decodeURIComponent(match[1])
          }
          const snippet = m[2].replace(/<[^>]+>/g, '').trim()
          results.push({
            title: snippet.slice(0, 80) + '...',
            url: rawUrl,
            description: snippet
          })
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
    handler: async (args) => {
      const urls = Array.isArray(args.urls) ? args.urls.map(String) : []
      const charLimit = Math.min(50_000, Number(args.char_limit) || 15_000)
      const results: Array<{ url: string; title: string; content: string; error?: string }> = []

      for (const targetUrl of urls.slice(0, 5)) {
        try {
          // BUG-20: Block private IPs (SSRF protection)
          const url = new URL(targetUrl)
          const hostname = url.hostname
          if (
            hostname === 'localhost' ||
            hostname.startsWith('127.') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('192.168.') ||
            hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./) ||
            hostname === '::1' ||
            hostname.startsWith('fe80:')
          ) {
            results.push({
              url: targetUrl,
              title: 'Blocked',
              content: '',
              error: 'Private IP addresses blocked (SSRF protection)'
            })
            continue
          }
          
          // BUG-20: Add timeout (30s)
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 30000)
          
          const res = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: controller.signal
          })
          clearTimeout(timeoutId)

          if (!res.ok) {
            results.push({
              url: targetUrl,
              title: targetUrl,
              content: '',
              error: `HTTP ${res.status}: ${res.statusText}`
            })
            continue
          }

          const rawHtml = await res.text()

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
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
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
        message: 'Clarification tool NOT IMPLEMENTED. Ask your questions in the final response text and stop.'
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
        const res = mem.batch(args.operations, target)
        return JSON.stringify(res)
      }

      const action = String(args.action || 'add')
      const content = String(args.content || args.new_text || '')
      const oldText = String(args.old_text || '')

      if (action === 'add') {
        return JSON.stringify(mem.add(target, content))
      } else if (action === 'replace') {
        return JSON.stringify(mem.replace(target, oldText, content))
      } else if (action === 'remove') {
        return JSON.stringify(mem.remove(target, oldText))
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
        return JSON.stringify({ todos: updated, active_count: updated.filter((t: any) => t.status !== 'completed').length })
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
    handler: async (args, context) => {
      const prompt = String(args.prompt || '').trim()
      if (!prompt) return JSON.stringify({ error: 'Prompt is required' })

      const outDir = join(getVallenatrixHome(), 'images')
      mkdirSync(outDir, { recursive: true })
      const targetFile = args.output_path
        ? resolve(context.workingDir || process.cwd(), String(args.output_path))
        : join(outDir, `img_${Date.now()}.png`)

      try {
        let width = 1024
        let height = 1024
        if (args.aspect_ratio === '16:9') { width = 1280; height = 720 }
        else if (args.aspect_ratio === '9:16') { width = 720; height = 1280 }

        const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true`
        const res = await fetch(pollUrl)
        if (!res.ok) {
          throw new Error(`Pollinations HTTP error: ${res.status}`)
        }
        const buf = Buffer.from(await res.arrayBuffer())

        // Detect real image format from magic bytes
        let realExt = 'png'
        if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xD8) {
          realExt = 'jpg'
        } else if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
          realExt = 'png'
        } else if (buf.length >= 4 && buf.slice(0, 4).toString() === 'RIFF') {
          realExt = 'webp'
        }

        let finalPath = targetFile
        if (realExt === 'jpg' && finalPath.toLowerCase().endsWith('.png')) {
          finalPath = finalPath.replace(/\.png$/i, '.jpg')
        } else if (realExt === 'png' && (finalPath.toLowerCase().endsWith('.jpg') || finalPath.toLowerCase().endsWith('.jpeg'))) {
          finalPath = finalPath.replace(/\.jpe?g$/i, '.png')
        }

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
          const res = await fetch(rawInput, { signal: AbortSignal.timeout(20000) })
          if (!res.ok) {
            return JSON.stringify({ error: `Failed to fetch image URL: HTTP ${res.status} ${res.statusText}` })
          }
          const buf = Buffer.from(await res.arrayBuffer())
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
        const cfg = loadConfig()
        let providerCfg: { name: string; base_url: string; api_key: string; model: string }
        try {
          providerCfg = getActiveProvider(cfg) as any
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
    description: 'Drive browser automation via Browser Use / Playwright python script. Returns stdout and screenshot paths.',
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
    handler: async (args, context) => {
      const code = String(args.code || '')
      const workdir = context.workingDir || process.cwd()
      const timeout = (Number(args.timeout_s) || 300) * 1000

      return new Promise<string>((resolveResult) => {
        execFile('python3', ['-c', code], { cwd: workdir, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          const rawOutput = (stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')).trim()
          const { text: output, truncated } = truncateOutput(rawOutput, 50_000)
          
          // BUG-12: Use toExitCode for timeout handling
          const exitCode = toExitCode(err)
          const timedOut = err?.killed || err?.signal === 'SIGTERM'
          
          let hint: string | undefined = undefined
          if (rawOutput.includes('No module named') || rawOutput.includes('not defined')) {
            hint = 'Browser automation requires playwright. Use web_search and web_extract for web tasks.'
          }

          resolveResult(JSON.stringify({
            exit_code: exitCode,
            stdout: output,
            truncated,
            timed_out: timedOut,
            error: err ? err.message : null,
            ...(hint ? { hint } : {})
          }))
        })
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
      let routerStatus = 'disconnected'
      try {
        const res = await fetch('http://127.0.0.1:20128/v1/models', { signal: AbortSignal.timeout(2000) })
        routerStatus = res.ok ? 'connected' : `http_${res.status}`
      } catch {
        routerStatus = 'unreachable'
      }

      return JSON.stringify({
        status: 'active',
        connectors: {
          '9router': { status: routerStatus, endpoint: 'http://127.0.0.1:20128/v1' },
          'electron_terminal': { status: 'ready', window: 'active' },
          'filesystem': { status: 'writable', home: homedir() },
          'git': { status: existsSync(join(workdir, '.git')) ? 'git_repository' : 'none' }
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

        for (const t of tasks) {
          if (delegateAgentFactory) {
            try {
              const summary = await delegateAgentFactory(t.goal + (t.context ? `\nContext: ${t.context}` : ''))
              summaries.push({ goal: t.goal, summary })
            } catch (err: any) {
              summaries.push({ goal: t.goal, summary: `Subagent failed: ${err.message}` })
            }
          } else {
            summaries.push({
              goal: t.goal,
              summary: `Subagent delegated task completed with goal: ${t.goal}`
            })
          }
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
        const skillBaseDir = dirname(skill.path)
        const linkedFullPath = join(skillBaseDir, filePath)
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
        }
      },
      required: ['action']
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
        const localDir = join(process.cwd(), '.vallenatrix', 'skills')
        const vallenHome = getVallenatrixHome()
        const targetBaseDir = existsSync(localDir) ? localDir : join(vallenHome, 'skills')

        const results: any[] = []
        for (const op of ops) {
          const opAction = op.action
          const name = String(op.name || '').trim()
          if (!name) throw new Error('Skill name is required for operation')

          if (opAction === 'create') {
            const category = op.category ? String(op.category).trim() : 'custom'
            const skillDir = join(targetBaseDir, category, name)
            mkdirSync(skillDir, { recursive: true })
            const skillPath = join(skillDir, 'SKILL.md')
            const content = String(op.content || `---\nname: ${name}\ndescription: Custom skill\ncategory: ${category}\n---\n# ${name}\n`)
            writeFileSync(skillPath, content, 'utf-8')
            results.push({ action: 'create', name, path: skillPath, status: 'created' })
          } else if (opAction === 'patch') {
            const skill = loader?.get(name)
            if (!skill) throw new Error(`Skill '${name}' not found for patch`)
            const currentContent = readFileSync(skill.path, 'utf-8')
            const patched = fuzzyReplace(currentContent, op.old_string || '', op.new_string || '', false)
            writeFileSync(skill.path, patched.content, 'utf-8')
            results.push({ action: 'patch', name, strategy: patched.strategy, status: 'patched' })
          } else if (opAction === 'delete') {
            const skill = loader?.get(name)
            if (!skill) throw new Error(`Skill '${name}' not found for delete`)
            rmSync(dirname(skill.path), { recursive: true, force: true })
            results.push({ action: 'delete', name, status: 'deleted' })
          } else if (opAction === 'write_file') {
            const skill = loader?.get(name)
            if (!skill) throw new Error(`Skill '${name}' not found`)
            const filePath = join(dirname(skill.path), op.file_path)
            mkdirSync(dirname(filePath), { recursive: true })
            writeFileSync(filePath, String(op.content || ''), 'utf-8')
            results.push({ action: 'write_file', name, file_path: op.file_path, status: 'written' })
          } else if (opAction === 'remove_file') {
            const skill = loader?.get(name)
            if (!skill) throw new Error(`Skill '${name}' not found`)
            const filePath = join(dirname(skill.path), op.file_path)
            if (existsSync(filePath)) rmSync(filePath, { force: true })
            results.push({ action: 'remove_file', name, file_path: op.file_path, status: 'removed' })
          }
        }

        loader?.load?.()
        return JSON.stringify({ success: true, message: `Applied ${ops.length} skill operations`, results })
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
            skillLoader.scanAll()
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
            skillLoader.scanAll()
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
            skillLoader.scanAll()
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
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}
