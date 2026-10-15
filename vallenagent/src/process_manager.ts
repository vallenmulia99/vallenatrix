import { randomUUID } from 'crypto'
import { spawn, ChildProcess } from 'child_process'

const MAX_OUTPUT = 1024 * 1024
const MAX_PROCESSES = 100

interface ProcessEntry {
  id: string
  owner: string
  command: string
  pid: number | undefined
  child: ChildProcess
  output: string
  running: boolean
  exitCode: number | null
  signal: string | null
  done: Promise<void>
  finish: () => void
  onExit?: (sessionId: string, exitCode: number | null, signal: string | null) => void
  startedAt: number
}

const processes = new Map<string, ProcessEntry>()

export function startBackgroundProcess(command: string, cwd: string, owner: string, onExit?: ProcessEntry['onExit']): Record<string, unknown> {
  if (!command.trim()) return { error: 'command is required' }
  for (const [id, entry] of processes) {
    if (!entry.running && processes.size >= MAX_PROCESSES) processes.delete(id)
    if (processes.size < MAX_PROCESSES) break
  }
  if (processes.size >= MAX_PROCESSES) return { error: 'Process limit reached; stop or wait for a process first.' }

  let child: ChildProcess
  try {
    child = spawn('/bin/sh', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err: any) {
    return { error: err.message || 'Failed to start process' }
  }
  const id = randomUUID()
  let finish!: () => void
  const entry: ProcessEntry = {
    id, owner, command, pid: child.pid, child, output: '', running: true,
    exitCode: null, signal: null, done: new Promise(resolve => { finish = resolve }), finish, onExit,
    startedAt: Date.now()
  }
  processes.set(id, entry)
  const append = (chunk: Buffer) => {
    if (entry.output.length < MAX_OUTPUT) entry.output += chunk.toString('utf8').slice(0, MAX_OUTPUT - entry.output.length)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', chunk => append(Buffer.from(`\n[STDERR]\n${chunk.toString('utf8')}`)))
  const finalize = (code: number | null, signal: string | null) => {
    if (!entry.running) return
    entry.exitCode = code
    entry.signal = signal
    entry.running = false
    finish()
    try { entry.onExit?.(id, code, signal) } catch {}
  }
  child.once('error', (err: Error) => {
    entry.output += `\n[Process error] ${err.message}`
    finalize(1, null)
  })
  child.once('close', (code, signal) => finalize(code, signal))
  return { session_id: id, pid: child.pid, background: true, running: true }
}

function getProcess(id: unknown, owner: string): ProcessEntry | string {
  if (typeof id !== 'string' || !id) return 'session_id is required'
  const entry = processes.get(id)
  return entry?.owner === owner ? entry : 'Unknown process session_id'
}

function snapshot(entry: ProcessEntry) {
  return {
    session_id: entry.id, pid: entry.pid, command: entry.command,
    running: entry.running, exit_code: entry.exitCode, signal: entry.signal,
    output: entry.output, started_at: entry.startedAt
  }
}

export async function manageProcess(args: Record<string, any>, owner: string): Promise<Record<string, unknown>> {
  const action = String(args.action || '')
  if (action === 'list') return { processes: [...processes.values()].filter(entry => entry.owner === owner).map(snapshot) }
  const found = getProcess(args.session_id, owner)
  if (typeof found === 'string') return { error: found }
  if (action === 'kill') {
    if (found.running && found.pid) {
      try { process.kill(-found.pid, 'SIGTERM') } catch (err: any) {
        if (err.code !== 'ESRCH') return { error: err.message || 'Failed to stop process' }
      }
    }
    return { success: true, ...snapshot(found) }
  }
  if (action === 'wait') {
    const timeout = Math.max(0, Math.min(300, Number(args.timeout) || 0))
    if (found.running && timeout > 0) {
      let timer: NodeJS.Timeout
      await Promise.race([found.done, new Promise(resolve => { timer = setTimeout(resolve, timeout * 1000) })])
      clearTimeout(timer!)
    }
    return snapshot(found)
  }
  if (action === 'poll') return snapshot(found)
  return { error: 'action must be one of: list, poll, wait, kill' }
}
