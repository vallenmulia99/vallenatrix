// Pretty printer for terminal presentation - Hermes CLI display engine

import { relative, resolve } from 'path'
import { homedir } from 'os'

export const ANSI = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  ITALIC: '\x1b[3m',
  UNDERLINE: '\x1b[4m',

  // Colors
  BLACK: '\x1b[30m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',

  // Bright
  BRIGHT_BLACK: '\x1b[90m',
  BRIGHT_RED: '\x1b[91m',
  BRIGHT_GREEN: '\x1b[92m',
  BRIGHT_YELLOW: '\x1b[93m',
  BRIGHT_BLUE: '\x1b[94m',
  BRIGHT_MAGENTA: '\x1b[95m',
  BRIGHT_CYAN: '\x1b[96m',
  BRIGHT_WHITE: '\x1b[97m',
}

export function getToolEmoji(name: string): string {
  switch (name) {
    case 'terminal': return '💻'
    case 'read_file': return '📖'
    case 'write_file': return '✍️ '
    case 'patch': return '🔧'
    case 'search_files': return '🔎'
    case 'web_search': return '🔍'
    case 'web_extract': return '🌐'
    case 'execute_code': return '⚙️ '
    case 'browser_exec': return '🌐'
    case 'image_generate': return '🎨'
    case 'clarify': return '❓'
    case 'memory': return '🧠'
    case 'todo_list': return '📝'
    case 'delegate_task': return '🤖'
    case 'skill_view':
    case 'skills_list':
    case 'skill_manage': return '📚'
    default: return '⚡'
  }
}

export function cutePath(filePath: string, cwd: string = process.cwd()): string {
  if (!filePath) return ''
  const home = homedir()
  const abs = resolve(cwd, filePath)

  const rel = relative(cwd, abs)
  if (rel && !rel.startsWith('..') && !rel.startsWith('/')) {
    return rel
  }

  if (abs.startsWith(home)) {
    return '~' + abs.slice(home.length)
  }

  return abs
}

export function formatToolStart(name: string, _args: Record<string, any> = {}): string {
  const emoji = getToolEmoji(name)
  return `  ${ANSI.DIM}┊${ANSI.RESET} ${emoji} preparing ${name}…`
}

export function formatUnifiedDiff(diff: string, maxLines: number = 30): string {
  if (!diff) return ''
  const lines = diff.split('\n')
  const formatted: string[] = []
  const sliceLines = lines.slice(0, maxLines)

  for (const line of sliceLines) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      formatted.push(`    ${ANSI.CYAN}${line}${ANSI.RESET}`)
    } else if (line.startsWith('@@')) {
      formatted.push(`    ${ANSI.DIM}${ANSI.CYAN}${line}${ANSI.RESET}`)
    } else if (line.startsWith('-')) {
      formatted.push(`    ${ANSI.RED}${line}${ANSI.RESET}`)
    } else if (line.startsWith('+')) {
      formatted.push(`    ${ANSI.GREEN}${line}${ANSI.RESET}`)
    } else {
      formatted.push(`    ${ANSI.DIM}${line}${ANSI.RESET}`)
    }
  }

  if (lines.length > maxLines) {
    formatted.push(`    ${ANSI.DIM}... (${lines.length - maxLines} more lines)${ANSI.RESET}`)
  }

  return formatted.join('\n')
}

function truncateString(str: string, maxLen: number = 60): string {
  if (!str) return ''
  const oneLine = str.replace(/\r?\n/g, ' ').trim()
  if (oneLine.length <= maxLen) return oneLine
  return oneLine.slice(0, maxLen - 3) + '...'
}

export function formatToolEnd(
  name: string,
  args: Record<string, any>,
  rawResult: string,
  durationSec: number = 0.0
): string {
  let parsed: any = null
  try {
    parsed = JSON.parse(rawResult)
  } catch {
    parsed = null
  }

  const durationStr = `${Math.max(0, durationSec).toFixed(1)}s`
  const emoji = getToolEmoji(name)
  const isError = Boolean(parsed && parsed.error)

  let verb = name
  let detail = ''
  let extraDiff = ''

  switch (name) {
    case 'terminal': {
      verb = '$'
      detail = truncateString(args.command || '', 55)
      if (parsed && parsed.exit_code !== undefined && parsed.exit_code !== 0) {
        detail += ` ${ANSI.RED}[exit ${parsed.exit_code}]${ANSI.RESET}`
      }
      break
    }
    case 'read_file': {
      verb = 'read'
      const p = cutePath(args.path || '')
      const range = args.offset ? ` L${args.offset}${args.limit ? `-${Number(args.offset) + Number(args.limit) - 1}` : ''}` : ''
      detail = `${truncateString(p, 40)}${range}`
      break
    }
    case 'write_file': {
      verb = 'write'
      const p = cutePath(args.path || '')
      detail = truncateString(p, 45)
      break
    }
    case 'patch': {
      verb = 'patch'
      const p = cutePath(args.path || '')
      detail = truncateString(p, 45)
      if (parsed && parsed.diff) {
        extraDiff = `\n  ${ANSI.DIM}┊ review diff${ANSI.RESET}\n${formatUnifiedDiff(parsed.diff)}`
      }
      break
    }
    case 'search_files': {
      const target = args.target || 'content'
      verb = target === 'files' ? 'find' : 'grep'
      const count = parsed?.total_count ?? (target === 'files' ? parsed?.files?.length : parsed?.matches?.length) ?? 0
      detail = `${truncateString(args.pattern || '', 30)} (${count} found)`
      break
    }
    case 'web_search': {
      verb = 'search'
      const count = parsed?.data?.web?.length || 0
      detail = `${truncateString(args.query || '', 35)} (${count} results)`
      break
    }
    case 'web_extract': {
      verb = 'extract'
      const firstUrl = Array.isArray(args.urls) ? args.urls[0] : (args.url || '')
      detail = truncateString(firstUrl, 45)
      break
    }
    case 'execute_code': {
      verb = 'exec'
      detail = 'python script'
      if (parsed && parsed.exit_code !== undefined && parsed.exit_code !== 0) {
        detail += ` ${ANSI.RED}[exit ${parsed.exit_code}]${ANSI.RESET}`
      }
      break
    }
    case 'image_generate': {
      verb = 'create'
      detail = truncateString(args.prompt || '', 40)
      break
    }
    case 'browser_exec': {
      verb = 'browser'
      detail = 'automation'
      break
    }
    case 'clarify': {
      verb = 'clarify'
      const q = args.questions?.[0]?.question || args.question || ''
      detail = truncateString(q, 40)
      break
    }
    case 'memory': {
      verb = 'memory'
      detail = `${args.target || 'memory'} ${args.action || 'update'}`
      break
    }
    case 'todo_list': {
      verb = 'todo'
      const count = parsed?.active_count ?? parsed?.todos?.length ?? 0
      detail = `${count} task(s)`
      break
    }
    case 'delegate_task': {
      verb = 'delegate'
      const g = args.tasks?.[0]?.goal || args.goal || ''
      detail = truncateString(g, 40)
      break
    }
    case 'skill_view': {
      verb = 'skill'
      detail = `${args.name || ''}`
      break
    }
    case 'skills_list': {
      verb = 'skills'
      const count = Array.isArray(parsed) ? parsed.length : 0
      detail = `list ${count} skills`
      break
    }
    default: {
      verb = name.slice(0, 9)
      detail = truncateString(JSON.stringify(args), 40)
      break
    }
  }

  if (isError) {
    detail += ` ${ANSI.RED}[error: ${parsed.error}]${ANSI.RESET}`
  }

  // Format: "  ┊ 💻 $         npm test  36.9s"
  const line = `  ${ANSI.DIM}┊${ANSI.RESET} ${emoji} ${verb.padEnd(9)} ${detail}  ${ANSI.DIM}${durationStr}${ANSI.RESET}`
  return extraDiff ? `${line}${extraDiff}` : line
}

export function formatResponseBox(
  content: string,
  label: string = ' ☤ Vallenatrix ',
  width: number = 80
): string {
  const borderChar = '─'
  const leftCorner = '╭'
  const rightCorner = '╮'
  const botLeft = '╰'
  const botRight = '╯'

  // Top header: ╭─ ☤ Vallenatrix ─────────────────────────────────────────────────────────────╮
  // Visual width: leftCorner (1) + borderChar (1) + label.length + topFill + rightCorner (1) = width
  const topFill = Math.max(0, width - 3 - label.length)
  const topBar = `${ANSI.CYAN}${leftCorner}${borderChar}${label}${borderChar.repeat(topFill)}${rightCorner}${ANSI.RESET}`

  // Bottom footer: ╰──────────────────────────────────────────────────────────────────────────────╯
  // Visual width: botLeft (1) + botFill + botRight (1) = width
  const botFill = Math.max(0, width - 2)
  const botBar = `${ANSI.CYAN}${botLeft}${borderChar.repeat(botFill)}${botRight}${ANSI.RESET}`

  const rawLines = content.split(/\r?\n/)
  const body = rawLines.map(line => line).join('\n')

  return `${topBar}\n${body}\n${botBar}`
}
