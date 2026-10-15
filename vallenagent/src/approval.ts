import { relative, sep, isAbsolute, resolve, basename, join } from 'path'
import { homedir } from 'os'
import { realpathSync } from 'fs'

/**
 * Local approval heuristic shared by every surface (Electron chat, Telegram
 * gateway, CLI). Mirrors Hermes' approval floors: destructive shell commands
 * and writes into sensitive paths are gated; ordinary project commands are not.
 */

const TERMINAL_DANGERS = /(?:\brm\s+(?:(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)|(?:-[a-z]*r[a-z]*\s+-[a-z]*f[a-z]*|-[a-z]*f[a-z]*\s+-[a-z]*r[a-z]*)|(?:--recursive\b[^\n]*\b--force\b|--force\b[^\n]*\b--recursive\b))|\bdd\s+if=|\bmkfs(?:\.|\s)|\b(?:shutdown|reboot)\b|\b(?:curl|wget)\b[^\n]*(?:\s-d\s*@|--data(?:-binary)?\s+@|\s-T\s|--upload-file\b)|\b(?:scp|rsync|nc|netcat)\b|\bchmod\s+-R\b|\bgit\s+push\b[^\n]*--force|\bgit\s+clean\b|\bgit\s+reset\b[^\n]*--hard|\bfind\b[^\n]*\s-delete\b|>\s*\/dev\/sd)/i
const SHELL_WRAPPER = /^\s*(?:(?:sudo|env|nohup|command|exec|time)\s+)*(?:sh|bash|dash|zsh|fish|node|python(?:\d+(?:\.\d+)?)?|perl|ruby)\s+-(?:c|e)\b/i
const SAFE_TERMINAL_COMMANDS = new Set(['ls', 'pwd', 'cat', 'head', 'tail', 'git', 'npm', 'node', 'python', 'python3', 'wc', 'file', 'stat', 'du', 'df', 'uname', 'whoami', 'which', 'type', 'grep', 'rg', 'find', 'sed', 'sort', 'uniq', 'cut', 'tr', 'printf', 'echo', 'date', 'env', 'printenv'])
function isSafeSyntaxCheckLoop(command: string): boolean {
  return command.trim().replace(/\s+/g, ' ') === `cd vallen-anime-space-rpg && for f in $(find src tests server.mjs -name '*.js' -o -name '*.mjs'); do node --check "$f" || echo "SYNTAX FAIL $f"; done; echo "--- syntax ok ---"; npm test`
}
const SENSITIVE_DIRS = ['.ssh', '.aws', '.gnupg', '.config', '.kube', '.docker', '.vallenatrix']
const SENSITIVE_ROOTS = ['/etc', '/usr', '/boot', '/root']
const SENSITIVE_RC = new Set(['.bashrc', '.zshrc', '.profile', '.bash_profile', '.zprofile', '.zshenv'])

const ENV_KEYS = ['VALLENATRIX_APPROVAL', 'VALLENATRIX_APPROVAL_MODE']

/** Approval mode for the current surface: 'dangerous' (gate risky ops), 'all', or 'off'. */
export function approvalMode(config?: any): 'dangerous' | 'all' | 'off' {
  for (const key of ENV_KEYS) {
    const value = process.env[key]
    if (value === 'all' || value === 'off' || value === 'dangerous') return value
  }
  const configured = typeof config === 'string' ? config : config?.approval
  if (configured === 'all' || configured === 'off' || configured === 'dangerous') return configured
  return 'dangerous'
}

export function normalizeToolPath(raw: string, workingDir = process.cwd()): string {
  let value = String(raw || '').trim()
  if (!value) return resolve(workingDir)
  if (value === '~') value = homedir()
  else if (value.startsWith('~/')) value = join(homedir(), value.slice(2))
  const absolute = isAbsolute(value) ? resolve(value) : resolve(workingDir, value)
  try { return realpathSync(absolute) } catch { return absolute }
}

function isSensitivePath(raw: string, workingDir = process.cwd()): boolean {
  const parts = String(raw).split(/[\\/]+/)
  if (parts.includes('..') && parts.some(part => SENSITIVE_DIRS.includes(part) || SENSITIVE_RC.has(part))) return true
  const target = normalizeToolPath(raw, workingDir)
  const home = normalizeToolPath(homedir())
  const sensitive = [...SENSITIVE_DIRS.map(dir => join(home, dir)), ...SENSITIVE_ROOTS]
  for (const root of sensitive) {
    const rel = relative(root, target)
    if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return true
  }
  const base = basename(target)
  if (SENSITIVE_RC.has(base) && /^\/(?:home|Users)\/[^/]+\//.test(target)) return true
  if (/^\/(?:home|Users)\/[^/]+\/(?:\.ssh|\.aws|\.gnupg|\.config|\.kube|\.docker|\.vallenatrix)(?:\/|$)/.test(target)) return true
  if (/^\/var\/spool\/cron(?:\/|$)|^\/etc\/cron(?:\.|\/)/.test(target)) return true
  return false
}

function shellSegments(command: string): string[][] {
  const segments: string[][] = []
  let tokens: string[] = []
  let token = ''
  let quote = ''
  let escaped = false
  let expectCommand = false
  const flushToken = () => { if (token) { tokens.push(token); token = '' } }
  const flushSegment = () => {
    flushToken()
    if (tokens.length) { segments.push(tokens); tokens = []; expectCommand = false }
  }
  const input = command.trim()
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (escaped) { token += char; escaped = false; continue }
    if (char === '\\' && quote !== "'") { escaped = true; continue }
    if (quote) { if (char === quote) quote = ''; else token += char; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '$' && input[i + 1] === '(' || char === '`' || char === '<') return []
    if (char === ';' || char === '\n' || char === '\r') { flushSegment(); continue }
    if (char === '&' || char === '|') {
      if (input[i + 1] === char && (char === '&' || char === '|')) {
        flushToken()
        if (!tokens.length) return []
        flushSegment()
        expectCommand = true
        i++
        continue
      }
      return []
    }
    if (char === '>' && (token === '1' || token === '2') && input.slice(i).startsWith('>/dev/null') && /^(?:1|2)>\/dev\/null(?:\s|;|&|$)/.test(input.slice(i - 1))) {
      token = ''
      i += '>/dev/null'.length - 1
      continue
    }
    if (char === '>') return []
    if (/\s/.test(char)) { flushToken(); continue }
    token += char
  }
  if (quote || escaped) return []
  flushSegment()
  return expectCommand || !segments.length ? [] : segments.map(segment => {
    while (['sudo', 'env', 'nohup', 'command', 'exec', 'time', 'xargs'].includes(segment[0]) && segment.length > 1) segment.shift()
    return segment
  })
}

export function requiresDangerousApproval(info: { name: string; args: Record<string, any> }): boolean {
  if (['execute_code', 'browser_exec'].includes(info.name)) return true
  if (info.name === 'skill_manage') {
    const operations = Array.isArray(info.args.operations) ? info.args.operations : [info.args]
    return operations.some((op: any) => ['create', 'patch', 'delete', 'install', 'update', 'uninstall'].includes(String(op?.action || op?.operation || '').toLowerCase()))
  }
  const workingDir = String(info.args.workdir || info.args.cwd || process.cwd())
  if (['read_file', 'write_file', 'patch', 'search_files'].includes(info.name)) {
    const raw = String(info.args.path || info.args.file_path || '.')
    return isSensitivePath(raw, workingDir)
  }
  if (info.name !== 'terminal') return false
  const command = String(info.args.command || '')
  if (isSafeSyntaxCheckLoop(command)) return false
  if (SHELL_WRAPPER.test(command) || TERMINAL_DANGERS.test(command)) return true
  const segments = shellSegments(command)
  if (!segments.length) return true
  for (const tokens of segments) {
    const binary = basename(tokens[0]).toLowerCase()
    if (!SAFE_TERMINAL_COMMANDS.has(binary)) return true
    for (const token of tokens.slice(1)) {
      if ((token.startsWith('/') || token.startsWith('~') || token.startsWith('.')) && isSensitivePath(token, workingDir)) return true
    }
    if (['node', 'python', 'python3'].includes(binary) && !tokens.slice(1).length) continue
    if (['node', 'python', 'python3'].includes(binary) && tokens.slice(1).some(arg => !['-v', '--version', '-V', '-h', '--help'].includes(arg))) return true
    if (binary === 'git' && !['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'describe'].includes(tokens[1])) return true
    if (binary === 'npm' && !['test', 'run', 'ls', 'view', 'audit', '-v', '--version', '-h', '--help'].includes(tokens[1])) return true
    if (binary === 'npm' && ['-v', '--version', '-h', '--help'].includes(tokens[1]) && tokens.length > 2) return true
  }
  return false
}

export function requiresApproval(info: { name: string; args: Record<string, any> }, mode: 'dangerous' | 'all' | 'off'): boolean {
  if (mode === 'off') return false
  if (mode === 'all') return true
  return requiresDangerousApproval(info)
}
