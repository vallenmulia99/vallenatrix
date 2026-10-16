import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { statSync } from 'fs'
import { homedir } from 'os'
import { IPC_CHANNELS } from '../shared/channels'
import { PtyManager } from './pty'
import { ConfigManager } from './config'
import { registerMediaProtocol, selectMediaFile } from './media'
import { handleSkillsCommand } from './skills_commands'
import { getStartupPayload } from './banner'
import { savePastedText } from './paste-store'
import { formatPerf, measurePerf } from './perf'

app.setName('Vallenatrix')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vallen-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false
    }
  }
])

// Disable buggy VAAPI drivers on Linux Intel chipsets to prevent freeze
app.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder,VaapiVideoEncoder')

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null
const configManager = new ConfigManager()

interface TerminalRuntime {
  id: string
  windowId: number
  terminalNumber: number
  ptyManager: PtyManager
  ptyStarted: boolean
  agentInstance: any | null
  output: string
  cwdRevision: number
  cwdOverride?: string
}

interface WindowRuntime {
  windowId: number
  terminals: Map<string, TerminalRuntime>
  activeTerminalId: string
  nextTerminalNumber: number
}

const windowRuntimes = new Map<number, WindowRuntime>()

function getWindowTabs(runtime: WindowRuntime): Array<{ id: string; label: string }> {
  return [...runtime.terminals.values()]
    .sort((a, b) => a.terminalNumber - b.terminalNumber)
    .map((terminal) => ({ id: terminal.id, label: `Vallenatrix ${terminal.terminalNumber}` }))
}

function broadcastTerminalWindows(window: BrowserWindow, runtime: WindowRuntime): void {
  if (!window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.WINDOW_TABS, {
      windows: getWindowTabs(runtime),
      activeId: runtime.activeTerminalId
    })
  }
}

function getActiveTerminalRuntime(runtime: WindowRuntime): TerminalRuntime {
  const terminal = runtime.terminals.get(runtime.activeTerminalId)
  if (!terminal) throw new Error('Terminal aktif tidak ditemukan.')
  return terminal
}

function getTerminalModel(terminal: TerminalRuntime): string {
  return getAgentInstance(terminal, terminal.windowId).provider.model
}

function createTerminalRuntime(runtime: WindowRuntime): TerminalRuntime {
  const terminalNumber = runtime.nextTerminalNumber++
  const terminal: TerminalRuntime = {
    id: `terminal-${terminalNumber}`,
    windowId: runtime.windowId,
    terminalNumber,
    ptyManager: new PtyManager(),
    ptyStarted: false,
    agentInstance: null,
    output: '',
    cwdRevision: 0
  }
  runtime.terminals.set(terminal.id, terminal)
  return terminal
}

function getWindowRuntime(window: BrowserWindow): WindowRuntime {
  const runtime = windowRuntimes.get(window.id)
  if (!runtime) throw new Error('Runtime Vallenatrix untuk jendela ini tidak tersedia.')
  return runtime
}

function getWindowForSender(sender: Electron.WebContents): BrowserWindow {
  const window = BrowserWindow.fromWebContents(sender)
  if (!window || window.isDestroyed()) throw new Error('Jendela Vallenatrix sudah ditutup.')
  return window
}

function getAgentInstance(runtime: TerminalRuntime, windowId: number): any {
  if (!runtime.agentInstance) {
    const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
    const { AIAgent } = require(vallenagentDist)
    runtime.agentInstance = new AIAgent({ sessionId: `window-${windowId}-${runtime.id}-${Date.now()}` })
  }
  return runtime.agentInstance
}

const { requiresApproval, approvalMode } = require(join(__dirname, '../../../vallenagent/dist/index.js'))

function resolveApprovalMode(): 'dangerous' | 'all' | 'off' {
  return approvalMode(configManager.loadConfig().agentApproval)
}

interface PendingApproval {
  resolve: (allowed: boolean) => void
  timer: NodeJS.Timeout
}

const pendingApprovals = new Map<string, PendingApproval>()
const APPROVAL_TIMEOUT_MS = 5 * 60_000

/** Ask the renderer (or fail closed) before running a gated tool. */
function requestApproval(info: { id: string; name: string; args: Record<string, any> }, terminalId: string): Promise<boolean> {
  const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0]
  if (!target || target.isDestroyed()) return Promise.resolve(false)
  const approvalId = `${terminalId}:${info.id}`
  const summary = info.name === 'terminal'
    ? `Tool: ${info.name}\nCommand: ${String(info.args.command || '').slice(0, 1500)}`
    : `Izinkan tool ${info.name} dijalankan?`
  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => {
      if (pendingApprovals.delete(approvalId)) resolve(false)
    }, APPROVAL_TIMEOUT_MS)
    pendingApprovals.set(approvalId, { resolve, timer })
    target.webContents.send(IPC_CHANNELS.AGENT_STATUS, {
      type: 'approval', id: info.id, terminalId, approvalId, message: summary
    })
    target.once('closed', () => {
      const pending = pendingApprovals.get(approvalId)
      if (pending) {
        pendingApprovals.delete(approvalId)
        clearTimeout(pending.timer)
        pending.resolve(false)
      }
    })
  })
}

function createWindow(startInTerminal = false): void {
  const window = new BrowserWindow({
    icon: join(__dirname, '../../assets/vallenatrix.png'),
    width: 900,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = window
  const runtime: WindowRuntime = { windowId: window.id, terminals: new Map(), activeTerminalId: '', nextTerminalNumber: 1 }
  const firstTerminal = createTerminalRuntime(runtime)
  runtime.activeTerminalId = firstTerminal.id
  windowRuntimes.set(window.id, runtime)

  window.loadFile(join(__dirname, '../renderer/index.html'), {
    query: startInTerminal ? { mode: 'terminal' } : undefined
  })
  window.webContents.once('did-finish-load', () => broadcastTerminalWindows(window, runtime))

  // Security: deny child windows and route valid external URLs to default browser
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url)
      }
    } catch {
      // Invalid URL
    }
    return { action: 'deny' }
  })

  // Prevent non-local navigation
  window.webContents.on('will-navigate', (event, url) => {
    let isAppDocument = false
    try {
      const target = new URL(url)
      const appDocument = new URL(`file://${resolve(__dirname, '../renderer/index.html')}`)
      isAppDocument = target.protocol === 'file:' && target.href === appDocument.href
    } catch {
      // Invalid URL
    }
    if (!isAppDocument) {
      event.preventDefault()
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          shell.openExternal(url)
        }
      } catch {
        // Invalid URL
      }
    }
  })

  // Window state events for auto-pausing video and UI adjustments
  window.on('focus', () => {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.WINDOW_STATE_CHANGE, 'focus')
  })

  window.on('blur', () => {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.WINDOW_STATE_CHANGE, 'blur')
  })

  window.on('minimize', () => {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.WINDOW_STATE_CHANGE, 'minimize')
  })

  window.on('restore', () => {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.WINDOW_STATE_CHANGE, 'restore')
  })

  window.on('closed', () => {
    for (const terminal of runtime.terminals.values()) terminal.ptyManager.kill()
    windowRuntimes.delete(window.id)
    if (mainWindow === window) mainWindow = BrowserWindow.getAllWindows()[0] || null
  })
}

function startPtyShell(
  window: BrowserWindow,
  terminal: TerminalRuntime,
  shellPath = configManager.loadConfig().shell,
  workingDirectory = terminal.agentInstance?.config.terminal?.cwd || process.cwd()
): void {
  terminal.ptyStarted = true
  terminal.ptyManager.spawn(shellPath, (data) => {
    terminal.output = (terminal.output + data).slice(-200_000)
    const runtime = windowRuntimes.get(window.id)
    if (runtime?.activeTerminalId === terminal.id && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.TERMINAL_DATA, { terminalId: terminal.id, data })
    }
  }, (exitCode) => {
    terminal.ptyStarted = false
    const runtime = windowRuntimes.get(window.id)
    if (runtime?.activeTerminalId === terminal.id && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.TERMINAL_EXIT, { terminalId: terminal.id, code: exitCode })
    }
  }, workingDirectory)
}

// Register IPC handlers
function setupIpc(): void {
  ipcMain.handle(IPC_CHANNELS.PASTE_SAVE, (event, text: unknown) => {
    getWindowForSender(event.sender)
    if (typeof text !== 'string') throw new Error('Pasted content must be plain text.')
    return savePastedText(homedir(), text)
  })

  ipcMain.on(IPC_CHANNELS.TERMINAL_START, (event) => {
    const window = getWindowForSender(event.sender)
    const runtime = getWindowRuntime(window)
    startPtyShell(window, getActiveTerminalRuntime(runtime))
  })

  ipcMain.on(IPC_CHANNELS.TERMINAL_INPUT, (event, data: string) => {
    if (typeof data === 'string') {
      const window = getWindowForSender(event.sender)
      getActiveTerminalRuntime(getWindowRuntime(window)).ptyManager.write(data)
    }
  })

  ipcMain.on(IPC_CHANNELS.TERMINAL_RESIZE, (event, size: { cols?: unknown; rows?: unknown } | null) => {
    const cols = size?.cols
    const rows = size?.rows
    if (typeof cols === 'number' && Number.isFinite(cols) && typeof rows === 'number' && Number.isFinite(rows)) {
      const window = getWindowForSender(event.sender)
      getActiveTerminalRuntime(getWindowRuntime(window)).ptyManager.resize(cols, rows)
    }
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    getWindowForSender(event.sender).minimize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    const window = getWindowForSender(event.sender)
    if (window.isMaximized()) {
        window.unmaximize()
      } else {
        window.maximize()
      }
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    getWindowForSender(event.sender).close()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_NEW, (event) => {
    const window = getWindowForSender(event.sender)
    const runtime = getWindowRuntime(window)
    const terminal = createTerminalRuntime(runtime)
    runtime.activeTerminalId = terminal.id
    window.webContents.send(IPC_CHANNELS.TERMINAL_SWITCHED, {
      terminalId: terminal.id,
      label: `Vallenatrix ${terminal.terminalNumber}`,
      output: '',
      model: getTerminalModel(terminal)
    })
    broadcastTerminalWindows(window, runtime)
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE_TERMINAL, (event, terminalId: unknown) => {
    if (typeof terminalId !== 'string') return false
    const window = getWindowForSender(event.sender)
    const runtime = getWindowRuntime(window)
    const terminal = runtime.terminals.get(terminalId)
    if (!terminal || runtime.terminals.size <= 1) return false

    terminal.agentInstance?.interrupt?.()
    terminal.ptyManager.kill()
    terminal.ptyStarted = false
    runtime.terminals.delete(terminalId)
    if (runtime.activeTerminalId === terminalId) {
      const next = [...runtime.terminals.values()].sort((a, b) => a.terminalNumber - b.terminalNumber)[0]
      runtime.activeTerminalId = next.id
      window.webContents.send(IPC_CHANNELS.TERMINAL_SWITCHED, {
        terminalId: next.id,
        label: `Vallenatrix ${next.terminalNumber}`,
        output: next.output,
        model: getTerminalModel(next)
      })
    }
    broadcastTerminalWindows(window, runtime)
    return true
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_SELECT, (event, terminalId: unknown) => {
    if (typeof terminalId !== 'string') return
    const window = getWindowForSender(event.sender)
    const runtime = getWindowRuntime(window)
    const terminal = runtime.terminals.get(terminalId)
    if (!terminal) return
    runtime.activeTerminalId = terminal.id
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.TERMINAL_SWITCHED, {
        terminalId: terminal.id,
        label: `Vallenatrix ${terminal.terminalNumber}`,
        output: terminal.output,
        model: getTerminalModel(terminal)
      })
      broadcastTerminalWindows(window, runtime)
    }
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_TABS_GET, (event) => {
    const window = getWindowForSender(event.sender)
    const runtime = getWindowRuntime(window)
    const terminal = getActiveTerminalRuntime(runtime)
    return {
      windows: getWindowTabs(runtime),
      activeId: terminal.id,
      output: terminal.output,
      label: `Vallenatrix ${terminal.terminalNumber}`,
      model: getTerminalModel(terminal)
    }
  })

  ipcMain.handle(IPC_CHANNELS.MEDIA_SELECT, async (event) => {
    return await selectMediaFile(getWindowForSender(event.sender))
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (event) => {
    getWindowForSender(event.sender)
    return configManager.loadConfig()
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_APPROVAL, (event, payload: { allowed: boolean; approvalId: string }) => {
    if (typeof payload?.approvalId !== 'string' || typeof payload.allowed !== 'boolean') return false
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) return false
    const pending = pendingApprovals.get(payload?.approvalId)
    if (!pending) return false
    pendingApprovals.delete(payload.approvalId)
    clearTimeout(pending.timer)
    pending.resolve(payload.allowed)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (event, newConfig) => {
    getWindowForSender(event.sender)
    return configManager.saveConfig(newConfig)
  })

  ipcMain.handle(IPC_CHANNELS.THEME_LIST, (event) => {
    getWindowForSender(event.sender)
    return configManager.listThemes()
  })

  ipcMain.handle(IPC_CHANNELS.THEME_GET, (event, name: string) => {
    getWindowForSender(event.sender)
    return configManager.getTheme(name)
  })

  ipcMain.handle(IPC_CHANNELS.THEME_SAVE, (event, theme) => {
    getWindowForSender(event.sender)
    return configManager.saveUserTheme(theme)
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, async (event, url: string) => {
    getWindowForSender(event.sender)
    if (typeof url !== 'string') return false
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        await shell.openExternal(url)
        return true
      }
    } catch {
      // Invalid URL
    }
    return false
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_BANNER, async (event) => {
    const window = getWindowForSender(event.sender)
    const runtime = getWindowRuntime(window)
    const terminal = getActiveTerminalRuntime(runtime)
    return getStartupPayload(getAgentInstance(terminal, window.id))
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (event, { message, model: userModel, terminalId: requestedTerminalId }: { message: string; model?: string; terminalId?: string }) => {
    try {
      const trimmed = message.trim()
      const window = getWindowForSender(event.sender)
      const windowRuntime = getWindowRuntime(window)
      const terminalRuntime = requestedTerminalId
        ? windowRuntime.terminals.get(requestedTerminalId) || getActiveTerminalRuntime(windowRuntime)
        : getActiveTerminalRuntime(windowRuntime)
      const agent = getAgentInstance(terminalRuntime, window.id)

      if (trimmed === '/cd' || trimmed.startsWith('/cd ')) {
        const requestedPath = trimmed.slice(3).trim()
        if (!requestedPath) {
          return { response: `Folder proyek tab ini: ${agent.config.terminal?.cwd || process.cwd()}\nGunakan /cd <path> untuk mengganti folder proyek.` }
        }
        const expandedPath = requestedPath.startsWith('~/') ? join(homedir(), requestedPath.slice(2)) : requestedPath
        const targetPath = resolve(agent.config.terminal?.cwd || process.cwd(), expandedPath)
        try {
          if (!statSync(targetPath).isDirectory()) return { response: `Bukan folder: ${targetPath}` }
        } catch {
          return { response: `Folder tidak ditemukan: ${targetPath}` }
        }
        if (!agent.config.terminal) agent.config.terminal = {}
        agent.config.terminal.cwd = targetPath
        agent.memoryStore.setWorkingDir(targetPath)
        terminalRuntime.cwdRevision++
        terminalRuntime.cwdOverride = targetPath
        terminalRuntime.output = ''
        startPtyShell(window, terminalRuntime, configManager.loadConfig().shell, targetPath)
        return { response: `Folder proyek tab ini sekarang: ${targetPath}` }
      }

      const { handleCommand } = require(join(__dirname, '../../../vallenagent/dist/commands.js'))
      const sharedCommand = await handleCommand({ channel: 'terminal', agent }, trimmed)
      if (sharedCommand.handled) return { response: sharedCommand.response }

      // Handle Slash Commands (T9: exact command parsing)
      const [cmd, ...rest] = trimmed.split(/\s+/)

      if (cmd === '/stop') {
        const stopped = agent.interrupt()
        const message = stopped ? 'Stopping agent turn…' : 'No agent turn is running.'
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.AGENT_STATUS, { type: stopped ? 'cancelled' : 'idle', message, terminalId: terminalRuntime.id })
        return { response: message, stopped }
      }

      if (cmd === '/auto') {
        const setting = rest[0]?.trim().toLowerCase()
        const current = resolveApprovalMode()
        const status = current === 'off'
          ? 'on (all tools auto-approved)'
          : current === 'dangerous'
            ? 'safe tools auto-approved; risky tools gated'
            : 'off (every tool asks for approval)'
        if (!setting || setting === 'status') {
          return { response: `Auto mode: ${status}. /auto on auto-approves all tools, including destructive/sensitive actions. /auto safe gates risky tools. /auto off asks before every tool.` }
        }
        if (setting === 'on' || setting === 'safe' || setting === 'off') {
          if (process.env.VALLENATRIX_APPROVAL || process.env.VALLENATRIX_APPROVAL_MODE) {
            return { response: 'Approval mode dikunci oleh environment. Hapus VALLENATRIX_APPROVAL* lalu coba lagi.' }
          }
          if (setting === 'on') {
            configManager.saveConfig({ agentApproval: 'off' })
            return { response: 'Auto-approval ON untuk semua tool, termasuk command berisiko dan operasi destruktif. Tool bisa menghapus atau mengubah data.' }
          }
          if (setting === 'safe') {
            configManager.saveConfig({ agentApproval: 'dangerous' })
            return { response: 'Auto-approval hanya untuk tool aman. Tool berisiko tetap minta izin.' }
          }
          configManager.saveConfig({ agentApproval: 'all' })
          return { response: 'Auto-approval OFF. Setiap tool minta izin.' }
        }
        return { response: 'Usage: /auto [on|safe|off|status]' }
      }

      if (cmd === '/session') {
        const subcommand = rest.join(' ').trim().toLowerCase()
        if (subcommand === 'clearall') {
          return {
            response: '\x1b[33mHapus semua riwayat sesi lokal?\x1b[0m Ini tidak bisa dibatalkan. Konfirmasi dengan \x1b[1m/session clearall confirm\x1b[0m.'
          }
        }
        if (subcommand === 'clearall confirm') {
          const agents = [...windowRuntimes.values()]
            .flatMap(windowRuntime => [...windowRuntime.terminals.values()])
            .map(terminal => terminal.agentInstance)
            .filter((instance, index, all) => instance && all.indexOf(instance) === index)
          await Promise.all(agents.map(instance => instance.resetSession()))
          const removed = agent.sessionManager.clearAllSessions()
          return { response: `\x1b[32mRiwayat ${removed} sesi lokal dihapus. Sesi aktif direset.\x1b[0m` }
        }
        return { response: '\x1b[33mGunakan /session clearall untuk menghapus seluruh riwayat sesi.\x1b[0m' }
      }

      if (cmd === '/perf') {
        const sample = await measurePerf()
        return { response: formatPerf(sample) }
      }

      if (cmd === '/health') {
        const provider = agent.getConfig().providers?.['9router']
        let gatewayStatus = 'Not configured'
        if (provider?.base_url) {
          try {
            await fetch(provider.base_url, { signal: AbortSignal.timeout(1500) })
            gatewayStatus = 'Connected'
          } catch {
            gatewayStatus = 'Unreachable'
          }
        }
        const memory = process.memoryUsage()
        const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`
        return { response: `Platform: ${process.platform} (${process.arch})\nMemory: RSS ${mib(memory.rss)}, heap used ${mib(memory.heapUsed)} / ${mib(memory.heapTotal)}, external ${mib(memory.external)}\n9router gateway: ${gatewayStatus}` }
      }

      if (cmd === '/token') {
        if (rest.length === 0) {
          const cfg = agent.getConfig()
          const p = cfg.providers['9router']
          const hasToken = p && p.api_key && p.api_key.length > 0
          return {
            response: `\x1b[36m[9router Token Config]\x1b[0m\nUsage: /token <your-api-key>\nCurrent status: ${hasToken ? '\x1b[32mConnected (key set)\x1b[0m' : '\x1b[31mNo token set\x1b[0m'}\nEndpoint: http://localhost:20128/v1\nModel: ${p?.model || 'ag/gemini-3.8-flash-medium'}`
          }
        }
        const newToken = rest[0].trim()
        
        // BUG-20: Mask token in terminal output
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.AGENT_STATUS, {
          type: 'system',
          message: '\x1b[90m[Command: /token ***]\x1b[0m'
        })
        
        agent.setToken(newToken, '9router')
        return {
          response: `\x1b[32m✔ 9router API token connected and saved!\x1b[0m\nEndpoint: http://localhost:20128/v1\nModel: ${agent.getConfig().providers['9router']?.model || 'ag/gemini-3.8-flash-medium'}`
        }
      }

      if (cmd === '/model') {
        if (rest.length === 0) {
          const cfg = agent.getConfig()
          const p = cfg.providers['9router'] || {}
          const activeModel = agent.provider.model || p.model || 'ag/gemini-3.8-flash-medium'
          const hasToken = p.api_key && p.api_key.length > 0
          return {
            response: `\x1b[36m[9router Model Config]\x1b[0m\nActive Model   : \x1b[32m${activeModel}\x1b[0m\nProvider       : 9router (http://localhost:20128/v1)\nToken Status   : ${hasToken ? '\x1b[32mConnected (Bearer key aktif)\x1b[0m' : '\x1b[31mNo token set (/token <key>)\x1b[0m'}\n\n\x1b[33mUsage:\x1b[0m\n  /model <model-name>\n\n\x1b[33mContoh:\x1b[0m\n  /model vallen/contoh\n  /model ag/gemini-3.8-flash-medium\n  /model kr/claude-sonnet-4.5-thinking-agentic\n  /model cl/openai/gpt-6.1-sol-pro\n  /model kr/deepseek-3.2-thinking-agentic\n  /model cl/qwen/qwen3.8-max-prime`
          }
        }
        const newModel = rest.join(' ').trim()
        agent.setModel(newModel)
        return {
          response: `\x1b[32m✔ Model updated to: ${newModel}\x1b[0m\nEndpoint: http://localhost:20128/v1 (via 9router Bearer token)`,
          updatedModel: newModel
        }
      }

      if (cmd === '/skills') {
        return await handleSkillsCommand(trimmed, agent, __dirname)
      }

      if (cmd === '/tools') {
        const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
        const { registry } = require(vallenagentDist)
        const toolList = registry.list()
        const byToolset: Record<string, string[]> = {}
        for (const t of toolList) {
          const ts = t.toolset || 'other'
          if (!byToolset[ts]) byToolset[ts] = []
          byToolset[ts].push(t.name)
        }
        const lines = ['\x1b[36m[Available Toolsets & Tools]\x1b[0m']
        for (const [ts, tools] of Object.entries(byToolset).sort(([a], [b]) => a.localeCompare(b))) {
          lines.push(`\x1b[33m${ts.padEnd(16)}\x1b[0m: ${tools.join(', ')}`)
        }
        return { response: lines.join('\n') }
      }

      if (cmd === '/memory') {
        const mem = agent.memoryStore.formatForSystemPrompt()
        return {
          response: mem || '\x1b[33mNo persistent memories stored yet.\x1b[0m'
        }
      }

      if (cmd === '/todos') {
        const td = agent.todoStore.formatForInjection()
        return {
          response: td || '\x1b[33mNo active todos in task list.\x1b[0m'
        }
      }

      if (cmd === '/sessions') {
        const sessions = agent.sessionManager.listSessions()
        if (sessions.length === 0) {
          return { response: '\x1b[33mNo saved sessions found in ~/.vallenatrix/sessions/\x1b[0m' }
        }
        const lines = ['\x1b[36m[Saved Chat Sessions]\x1b[0m']
        for (const s of sessions.slice(0, 10)) {
          const dateStr = s.updated_at ? s.updated_at.replace('T', ' ').slice(0, 16) : ''
          lines.push(`• \x1b[32m${s.id}\x1b[0m \x1b[37m"${s.title}"\x1b[0m \x1b[2m(${dateStr} | ${s.model})\x1b[0m`)
        }
        lines.push(`\n\x1b[33mUsage:\x1b[0m /resume <session-id>`)
        return { response: lines.join('\n') }
      }

      if (cmd === '/resume') {
        const targetId = rest[0]?.trim() || 'latest'
        const sessionId = targetId.toLowerCase() === 'latest'
          ? agent.sessionManager.listSessions()[0]?.id
          : targetId
        if (!sessionId) return { response: '\x1b[33mNo saved sessions to resume.\x1b[0m' }
        const ok = agent.resumeSession(sessionId)
        if (ok) {
          return {
            response: `\x1b[32m✔ Resumed session [${sessionId}]\x1b[0m\nModel: ${agent.provider.model}\nWorking Directory: ${agent.config.terminal?.cwd || process.cwd()}`,
            updatedModel: agent.provider.model
          }
        } else {
          return { response: `\x1b[31mSession not found: ${sessionId}\x1b[0m` }
        }
      }

      if (cmd === '/new' || cmd === '/reset') {
        agent.resetSession()
        return {
          response: `\x1b[32m✔ Session reset. Started fresh conversation context.\x1b[0m`
        }
      }

      if (cmd === '/themes') {
        const themeList = configManager.listThemes()
        const currentCfg = configManager.loadConfig()
        const lines = ['\x1b[36m[Available Themes]\x1b[0m']
        for (const t of themeList) {
          const isCur = t.name === currentCfg.themeName
          lines.push(`${isCur ? '\x1b[32m▶ ' : '  '}\x1b[1m${t.name.padEnd(16)}\x1b[0m \x1b[2m(${t.displayName}${t.isBuiltIn ? '' : ' - Custom'})\x1b[0m${isCur ? ' \x1b[32m[Active]\x1b[0m' : ''}`)
        }
        lines.push(`\n\x1b[33mUsage:\x1b[0m /theme <name> (contoh: /theme nord-frost)`)
        return { response: lines.join('\n') }
      }

      if (cmd === '/theme') {
        if (rest.length === 0) {
          const currentCfg = configManager.loadConfig()
          return {
            response: `\x1b[36m[Active Theme]\x1b[0m: ${currentCfg.themeName}\n\x1b[33mUsage:\x1b[0m /theme <name>\n(Gunakan /themes untuk melihat daftar lengkap)`
          }
        }
        const targetTheme = rest[0].trim()
        const themeObj = configManager.getTheme(targetTheme)
        if (!themeObj) {
          return { response: `\x1b[31mTheme not found: ${targetTheme}\x1b[0m. Gunakan /themes untuk melihat daftar.` }
        }
        configManager.saveConfig({ themeName: targetTheme })
        return {
          response: `\x1b[32m✔ Theme switched to: ${targetTheme} (${themeObj.displayName})\x1b[0m`,
          themeChange: targetTheme
        }
      }

      if (trimmed === '/stats' || trimmed === '/cost') {
        const cfg = agent.getConfig()
        const currentSession = agent.getSessionId()
        const p = cfg.providers['9router'] || {}
        const model = agent.provider.model || p.model
        const skillsCount = agent.skillLoader.list().length
        const todosCount = agent.todoStore.read().length
        const lines = [
          '\x1b[36m╭─ ☤ Vallenatrix Telemetry & Stats ────────────────────────────────╮\x1b[0m',
          `  Session ID       : \x1b[32m${currentSession}\x1b[0m`,
          `  Active Model     : \x1b[35m${model}\x1b[0m`,
          `  Provider BaseURL : ${agent.provider.baseURL}`,
          `  Working Dir      : \x1b[33m${agent.config.terminal?.cwd || process.cwd()}\x1b[0m`,
          `  Loaded Skills    : \x1b[36m${skillsCount} modular skills\x1b[0m`,
          `  Active Todos     : \x1b[33m${todosCount} task(s)\x1b[0m`,
          `  Memory Status    : Persistent (MEMORY.md & USER.md loaded)`,
          '\x1b[36m╰──────────────────────────────────────────────────────────────────╯\x1b[0m'
        ]
        return { response: lines.join('\n') }
      }

      if (trimmed === '/pty' || trimmed === '/sh') {
        return {
          response: `\x1b[32m✔ Direct Shell Mode Active (PTY).\x1b[0m\nDirect bash shell enabled.\nPress \x1b[33mCtrl+\`\x1b[0m to return to AI Chat Mode.`,
          togglePty: true
        }
      }

      if (trimmed === '/plans') {
        const cwd = agent.config.terminal?.cwd || process.cwd()
        const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
        const { listPlans } = require(vallenagentDist)
        const plans = listPlans(cwd)
        if (plans.length === 0) {
          return { response: '\x1b[33mNo plans found in .vallenatrix/plans/\x1b[0m\nUse /plan <task> to create an implementation plan.' }
        }
        const lines = ['\x1b[36m[Implementation Plans (.vallenatrix/plans/)]\x1b[0m']
        for (const p of plans.slice(0, 15)) {
          const dateStr = p.createdAt ? new Date(p.createdAt).toISOString().replace('T', ' ').slice(0, 16) : ''
          lines.push(`• \x1b[32m${p.filename}\x1b[0m \x1b[2m(${dateStr} | ${p.size} B)\x1b[0m`)
        }
        lines.push(`\n\x1b[33mTip:\x1b[0m Use /plan <task> to create a new plan or inspect files with read_file.`)
        return { response: lines.join('\n') }
      }

      if (trimmed === '/gamedev') {
        const skills = agent.skillLoader.list()
        const gameSkills = skills.filter((s: any) => {
          const cat = s.metadata.category || ''
          return cat.includes('game') || cat.includes('godot') || cat.includes('unity') || 
                 cat.includes('unreal') || cat.includes('roblox') || cat.includes('blender')
        })
        
        if (gameSkills.length === 0) {
          return {
            response: `\x1b[31m[Game Dev Mode]\x1b[0m\nNo game development skills found.\nInstall game dev skills to ~/.vallenatrix/skills/\n\nSupported engines: Unity, Godot, Unreal, Roblox, Blender`
          }
        }
        
        agent.setGameDevMode(true)
        const lines = [
          '\x1b[32m✔ Game Dev Mode Activated!\x1b[0m',
          '\x1b[36m╭─ 🎮 Game Development Boost ───────────────────────────────────╮\x1b[0m',
          `  Loaded Skills    : \x1b[33m${gameSkills.length} game dev skills\x1b[0m`,
          `  Active Model     : \x1b[35m${agent.provider.model}\x1b[0m`,
          '',
          '  \x1b[36mFocus Areas:\x1b[0m',
          '  • Unity C# architecture & editor tools',
          '  • Godot GDScript gameplay & multiplayer',
          '  • Unreal C++ systems & Blueprints',
          '  • Roblox Lua scripting & experiences',
          '  • Blender Python asset pipeline',
          '  • Game design patterns & optimization',
          '',
          '  \x1b[33mAI agent will prioritize:\x1b[0m',
          '  ✓ Game engine patterns & best practices',
          '  ✓ Asset workflow automation',
          '  ✓ Performance optimization (60+ FPS)',
          '  ✓ Shader programming & visual effects',
          '  ✓ Multiplayer architecture',
          '\x1b[36m╰──────────────────────────────────────────────────────────────╯\x1b[0m',
          '',
          '\x1b[2mUse /gamedev off to deactivate game dev mode\x1b[0m'
        ]
        return { response: lines.join('\n'), gameDevMode: true }
      }

      if (trimmed === '/gamedev off') {
        agent.setGameDevMode(false)
        return {
          response: `\x1b[33m✔ Game Dev Mode Deactivated\x1b[0m\nReturned to general-purpose agent mode.`,
          gameDevMode: false
        }
      }

      if (trimmed === '/help') {
        return {
          response: `\x1b[36m[Vallenatrix Autonomous AI Terminal Commands]\x1b[0m
/model <name>  - Switch active AI model (e.g. /model ag/gemini-3.8-flash-medium)
/geteway [wa|tele] - Pilih gateway WhatsApp atau Telegram
/token <key>   - Connect and persist 9router API key
/gamedev       - Activate game development boost mode (Unity/Godot/Unreal/Roblox/Blender)
/plan [task]   - Write markdown implementation plan (.vallenatrix/plans/) without executing
/plans         - List saved implementation plans in .vallenatrix/plans/
/tools         - Inspect registered tools across all toolsets
/skills        - Manage modular skills (search, install, toggle)
/themes        - List available UI color themes
/theme <name>  - Switch UI theme instantly
/stats         - Telemetry, context usage, and token latency
/memory        - Inspect persistent memory and user profile
/todos         - View active task list
/sessions      - List saved chat sessions
/session clearall - Delete all saved sessions (requires confirm)
/health        - Show platform, memory, and 9router gateway status
/auto [on|off] - Auto-approve safe tools; dangerous tools still ask
/perf          - Sample this app process CPU and RSS for 1 second
/resume <id>   - Resume a previous chat session
/cd <path>     - Change this terminal and agent's project folder
/stop          - Interrupt active running agent turn
/pty | /sh     - Enter direct PTY shell mode (hotkey: Ctrl+\`)
/new | /reset  - Start fresh conversation context
/clear         - Clear terminal display
/help          - Show this command reference`
        }
      }

      let effectiveMessage = message
      if (cmd === '/plan') {
        const task = rest.join(' ').trim()
        const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
        const { buildPlanPrompt } = require(vallenagentDist)
        effectiveMessage = buildPlanPrompt(task)
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.AGENT_STATUS, {
          type: 'thinking',
          message: task ? `📋 Planning: ${task}` : '📋 Planning from conversation context...'
        })
      }

      if (userModel && userModel !== agent.provider.model) {
        agent.setModel(userModel)
      }

      // Live status callback through webContents send
      const callbacks = {
        onThinking: (status: string) => {
          if (!window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.AGENT_STATUS, { type: 'thinking', message: status, terminalId: terminalRuntime.id })
          }
        },
        onToolStart: (info: any) => {
          if (!window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.AGENT_STATUS, { type: 'tool_start', message: info.preview, terminalId: terminalRuntime.id })
            if (info.name === 'terminal') {
              window.webContents.send(IPC_CHANNELS.AGENT_STATUS, {
                type: 'terminal_start', id: info.id, terminalId: terminalRuntime.id,
                command: String(info.args.command || ''),
                message: String(info.args.command || 'perintah terminal')
              })
            }
          }
        },
        onToolEnd: (info: any) => {
          if (!window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.AGENT_STATUS, { type: 'tool_end', message: info.preview, terminalId: terminalRuntime.id })
            if (info.name === 'terminal') {
              window.webContents.send(IPC_CHANNELS.AGENT_STATUS, {
                type: 'terminal_end', id: info.id, terminalId: terminalRuntime.id,
                message: String(info.result || '')
              })
            }
          }
        },
        onTerminalOutput: (info: { id: string; stream: string; chunk: string }) => {
          if (!window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.AGENT_STATUS, {
              type: 'terminal_output', id: info.id, terminalId: terminalRuntime.id, stream: info.stream, chunk: info.chunk, message: ''
            })
          }
        },
        onBeforeTool: (info: { id: string; name: string; args: Record<string, any> }) => {
          const mode = resolveApprovalMode()
          if (!requiresApproval({ name: info.name, args: info.args }, mode)) return Promise.resolve(true)
          return requestApproval(info, terminalRuntime.id)
        },
        onReviewComplete: (summary: string) => {
          if (!window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.AGENT_STATUS, { type: 'review_complete', terminalId: terminalRuntime.id, message: `💾 Self-improvement: ${summary}` })
          }
        },
        onReviewError: (error: string) => {
          if (!window.isDestroyed()) {
            console.error('[Review] Background review error:', error)
          }
        }
      }

      const cwdRevisionAtStart = terminalRuntime.cwdRevision
      const res = await agent.chat(effectiveMessage, callbacks)
      if (terminalRuntime.cwdRevision !== cwdRevisionAtStart && terminalRuntime.cwdOverride) {
        if (!agent.config.terminal) agent.config.terminal = {}
        agent.config.terminal.cwd = terminalRuntime.cwdOverride
      }
      const savedSession = agent.sessionManager.listSessions().find((session: any) => session.id === agent.getSessionId())
      const sessionTitle = String(savedSession?.title || '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').replace(/"/g, '\\"')
      const sessionDate = savedSession ? new Date(savedSession.updated_at) : null
      const sessionDateText = sessionDate && !Number.isNaN(sessionDate.getTime())
        ? sessionDate.toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : ''
      const sessionLabel = savedSession && sessionDateText
        ? `${savedSession.id} ("${sessionTitle}") (${sessionDateText} | ${savedSession.model})`.slice(0, 63)
        : ''
      return {
        response: res.response,
        sessionLabel,
        completionStatus: res.completionStatus,
        telemetry: {
          totalTokens: res.totalTokens,
          promptTokens: res.promptTokens,
          completionTokens: res.completionTokens,
          iterations: res.iterations,
          toolCalls: res.toolCalls,
          latencySec: res.latencySec,
          tokensPerSec: res.tokensPerSec,
          contextWindow: res.contextWindow
        }
      }
    } catch (err: any) {
      console.error('[Main] Agent chat error:', err)
      return { error: err.message || 'Agent error' }
    }
  })
}

app.whenReady().then(() => {
  registerMediaProtocol()
  setupIpc()
  createWindow(process.argv.includes('--new-window'))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  for (const runtime of windowRuntimes.values()) {
    for (const terminal of runtime.terminals.values()) terminal.ptyManager.kill()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
