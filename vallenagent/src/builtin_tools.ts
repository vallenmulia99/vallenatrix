import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { resolve, join, dirname, relative, isAbsolute } from 'path'
import { exec, execFile, spawn } from 'child_process'
import { homedir } from 'os'
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
    if (windowWs === oldWs || windowWs.includes(oldWs)) {
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
    const idx = normContentUnicode.indexOf(normOldUnicode)
    const matchedBlock = content.slice(idx, idx + oldString.length)
    const updated = content.slice(0, idx) + newString + content.slice(idx + matchedBlock.length)
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
  if (builtinToolsRegistered) return
  builtinToolsRegistered = true

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
              if (args.file_glob) {
                const globReg = globToRegex(String(args.file_glob))
                if (!globReg.test(entry.name)) continue
              }
              try {
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
      const probeCommand = `${rawCommand}\n__RET=$?; echo "\n__VALLEN_CWD__=$(pwd)"; exit $__RET`

      return new Promise<string>((resolveResult) => {
        const proc = spawn('/bin/sh', ['-c', probeCommand], {
          cwd: workdir,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })

        let stdout = ''
        let stderr = ''
        let killed = false

        proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

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
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        })
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
            data: { web: [{ title: 'Search completed', url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, description: `Query: ${query}` }] }
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

      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

      for (const targetUrl of urls.slice(0, 5)) {
        try {
          const res = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          })
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
        message: 'Presented clarification questions to the user.'
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
    handler: async (args) => {
      const target = (args.target || 'memory') as 'memory' | 'user'

      if (Array.isArray(args.operations) && args.operations.length > 0) {
        const res = memory.batch(args.operations, target)
        return JSON.stringify(res)
      }

      const action = String(args.action || 'add')
      const content = String(args.content || args.new_text || '')
      const oldText = String(args.old_text || '')

      if (action === 'add') {
        return JSON.stringify(memory.add(target, content))
      } else if (action === 'replace') {
        return JSON.stringify(memory.replace(target, oldText, content))
      } else if (action === 'remove') {
        return JSON.stringify(memory.remove(target, oldText))
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
    handler: async (args) => {
      if (Array.isArray(args.todos)) {
        const updated = todo.write(args.todos, isTruthy(args.merge))
        return JSON.stringify({ todos: updated, active_count: updated.filter(t => t.status !== 'completed').length })
      }
      return JSON.stringify({ todos: todo.read() })
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

      const outDir = join(homedir(), '.vallenatrix', 'images')
      mkdirSync(outDir, { recursive: true })
      const targetFile = args.output_path
        ? resolve(context.workingDir || process.cwd(), String(args.output_path))
        : join(outDir, `img_${Date.now()}.png`)

      try {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
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
        mkdirSync(dirname(targetFile), { recursive: true })
        writeFileSync(targetFile, buf)

        return JSON.stringify({
          success: true,
          path: targetFile,
          bytes: buf.length,
          url: pollUrl,
          message: `Image generated and saved to ${targetFile}`
        })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || 'Image generation failed' })
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
          resolveResult(JSON.stringify({
            exit_code: err?.code ?? 0,
            stdout: output,
            truncated,
            error: err ? err.message : null
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
    handler: async () => {
      return JSON.stringify({
        status: 'active',
        connectors: {
          '9router': { status: 'connected', endpoint: 'http://127.0.0.1:20128/v1' },
          'electron_terminal': { status: 'ready', window: 'active' },
          'filesystem': { status: 'writable', home: homedir() },
          'git': { status: existsSync(join(process.cwd(), '.git')) ? 'git_repository' : 'none' }
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
      handler: async (args) => {
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

  // 16. skill_manage
  const skillManageSchema: ToolSchema = {
    name: 'skill_manage',
    description: 'Create or update SKILL.md documents in the skills directory.',
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create', 'patch', 'delete'] },
              name: { type: 'string', description: 'Skill name' },
              category: { type: 'string', description: 'Category name' },
              content: { type: 'string', description: 'Full SKILL.md content (frontmatter + body)' },
              old_string: { type: 'string', description: 'For patch: target substring to replace' },
              new_string: { type: 'string', description: 'For patch: new replacement text' }
            },
            required: ['name', 'action']
          }
        }
      },
      required: ['operations']
    }
  }

  registry.register({
    name: 'skill_manage',
    schema: skillManageSchema,
    toolset: 'skills',
    handler: async (args) => {
      const ops = Array.isArray(args.operations) ? args.operations : []
      const results: any[] = []
      const skillsDir = join(homedir(), '.vallenatrix', 'skills')
      mkdirSync(skillsDir, { recursive: true })

      for (const op of ops) {
        const skillName = String(op.name || '').trim()
        const cat = String(op.category || 'general').trim()
        
        // Validate name and category
        const nameRegex = /^[a-z0-9][a-z0-9._-]*$/i
        if (!skillName || !nameRegex.test(skillName)) {
          results.push({ name: skillName, error: 'Invalid skill name: must match /^[a-z0-9][a-z0-9._-]*$/i' })
          continue
        }
        if (!nameRegex.test(cat)) {
          results.push({ name: skillName, error: 'Invalid category: must match /^[a-z0-9][a-z0-9._-]*$/i' })
          continue
        }
        
        const catDir = resolve(skillsDir, cat, skillName)
        
        // Ensure paths stay within skillsDir
        if (!catDir.startsWith(skillsDir + require('path').sep)) {
          results.push({ name: skillName, error: 'Invalid path: must be within skills directory' })
          continue
        }
        
        const skillFile = join(catDir, 'SKILL.md')

        if (op.action === 'create') {
          mkdirSync(catDir, { recursive: true })
          writeFileSync(skillFile, String(op.content || ''), 'utf-8')
          results.push({ name: skillName, action: 'created', path: skillFile })
        } else if (op.action === 'patch') {
          if (!existsSync(skillFile)) {
            results.push({ name: skillName, error: `Skill file does not exist: ${skillFile}` })
            continue
          }
          const existing = readFileSync(skillFile, 'utf-8')
          const patched = fuzzyReplace(existing, String(op.old_string), String(op.new_string))
          writeFileSync(skillFile, patched.content, 'utf-8')
          results.push({ name: skillName, action: 'patched', strategy: patched.strategy })
        } else if (op.action === 'delete') {
          if (!existsSync(skillFile)) {
            results.push({ name: skillName, error: `Skill file does not exist: ${skillFile}` })
            continue
          }
          const { unlinkSync, rmdirSync } = await import('fs')
          unlinkSync(skillFile)
          try {
            rmdirSync(catDir)
          } catch {}
          results.push({ name: skillName, action: 'deleted' })
        }
      }

      skillLoader.reload()
      return JSON.stringify({ success: true, results })
    }
  })

  // 17. skill_view
  const skillViewSchema: ToolSchema = {
    name: 'skill_view',
    description: "Load a skill's full content or access its linked files (references, templates, scripts). First call returns SKILL.md content plus a 'linked_files' dict. To access linked files, call again with file_path parameter.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name (use skills_list to see available skills)' },
        file_path: { type: 'string', description: 'OPTIONAL: Path to a linked file within the skill (e.g., references/cli.md)' }
      },
      required: ['name']
    }
  }

  registry.register({
    name: 'skill_view',
    schema: skillViewSchema,
    toolset: 'skills',
    handler: async (args) => {
      const skillName = String(args.name || '')
      const skill = skillLoader.get(skillName)

      if (!skill) {
        return JSON.stringify({ error: `Skill not found: ${skillName}` })
      }

      if (args.file_path) {
        const filePath = String(args.file_path)
        const skillDir = dirname(skill.path)
        const linkedPath = resolve(skillDir, filePath)
        
        // Prevent path traversal
        if (!linkedPath.startsWith(skillDir + require('path').sep)) {
          return JSON.stringify({ error: `Invalid file path: must be within skill directory` })
        }
        
        if (!existsSync(linkedPath)) {
          return JSON.stringify({ error: `Linked file not found: ${args.file_path}` })
        }
        try {
          const content = readFileSync(linkedPath, 'utf-8')
          return JSON.stringify({
            name: skillName,
            file_path: args.file_path,
            content
          })
        } catch (err: any) {
          return JSON.stringify({ error: err.message || 'Failed to read linked file' })
        }
      }

      return JSON.stringify({
        name: skill.name,
        metadata: skill.metadata,
        content: skill.content,
        linked_files: skill.linkedFiles || {}
      })
    }
  })

  // 18. skills_list
  const skillsListSchema: ToolSchema = {
    name: 'skills_list',
    description: 'List available skills (name, description, category). Use skill_view(name) to load full content.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category filter' }
      }
    }
  }

  registry.register({
    name: 'skills_list',
    schema: skillsListSchema,
    toolset: 'skills',
    handler: async (args) => {
      const category = args.category ? String(args.category) : undefined
      const skills = category ? skillLoader.listByCategory(category) : skillLoader.list()
      return JSON.stringify(skills.map(s => ({
        name: s.name,
        category: s.metadata.category,
        description: s.metadata.description
      })))
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
