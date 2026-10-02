import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { IPC_CHANNELS } from '../shared/channels'
import { PtyManager } from './pty'
import { ConfigManager } from './config'
import { registerMediaProtocol, selectMediaFile } from './media'
import { handleSkillsCommand } from './skills_commands'
import { getStartupPayload } from './banner'

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
const ptyManager = new PtyManager()
const configManager = new ConfigManager()

function createWindow(): void {
  const config = configManager.loadConfig()

  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  // Security: deny child windows and route valid external URLs to default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
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
  mainWindow.on('focus', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_STATE_CHANGE, 'focus')
  })

  mainWindow.on('blur', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_STATE_CHANGE, 'blur')
  })

  mainWindow.on('minimize', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_STATE_CHANGE, 'minimize')
  })

  mainWindow.on('restore', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_STATE_CHANGE, 'restore')
  })

  // Start PTY shell
  ptyManager.spawn(
    config.shell,
    (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.TERMINAL_DATA, data)
      }
    },
    (_exitCode) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.TERMINAL_EXIT, _exitCode)
        mainWindow.close()
      }
    }
  )

  mainWindow.on('closed', () => {
    ptyManager.kill()
    mainWindow = null
  })
}

// Register IPC handlers
function setupIpc(): void {
  ipcMain.on(IPC_CHANNELS.TERMINAL_INPUT, (_event, data: string) => {
    if (typeof data === 'string') {
      ptyManager.write(data)
    }
  })

  ipcMain.on(IPC_CHANNELS.TERMINAL_RESIZE, (_event, { cols, rows }: { cols: number; rows: number }) => {
    if (typeof cols === 'number' && typeof rows === 'number') {
      ptyManager.resize(cols, rows)
    }
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
    }
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow?.close()
  })

  ipcMain.handle(IPC_CHANNELS.MEDIA_SELECT, async () => {
    if (!mainWindow) return { canceled: true }
    return await selectMediaFile(mainWindow)
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, () => {
    return configManager.loadConfig()
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_event, newConfig) => {
    return configManager.saveConfig(newConfig)
  })

  ipcMain.handle(IPC_CHANNELS.THEME_LIST, () => {
    return configManager.listThemes()
  })

  ipcMain.handle(IPC_CHANNELS.THEME_GET, (_event, name: string) => {
    return configManager.getTheme(name)
  })

  ipcMain.handle(IPC_CHANNELS.THEME_SAVE, (_event, theme) => {
    return configManager.saveUserTheme(theme)
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, async (_event, url: string) => {
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

  ipcMain.handle(IPC_CHANNELS.SYSTEM_BANNER, async () => {
    return getStartupPayload(getAgentInstance())
  })

  let agentInstance: any = null
  function getAgentInstance() {
    if (!agentInstance) {
      const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
      const { AIAgent } = require(vallenagentDist)
      agentInstance = new AIAgent()
    }
    return agentInstance
  }

  ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (_event, { message, model: userModel }: { message: string; model?: string }) => {
    try {
      const trimmed = message.trim()
      const agent = getAgentInstance()

      // Handle Slash Commands
      if (trimmed.startsWith('/token')) {
        const parts = trimmed.split(/\s+/)
        if (parts.length < 2) {
          const cfg = agent.getConfig()
          const p = cfg.providers['9router']
          const hasToken = p && p.api_key && p.api_key.length > 0
          return {
            response: `\x1b[36m[9router Token Config]\x1b[0m\nUsage: /token <your-api-key>\nCurrent status: ${hasToken ? '\x1b[32mConnected (key set)\x1b[0m' : '\x1b[31mNo token set\x1b[0m'}\nEndpoint: http://localhost:20128/v1\nModel: ${p?.model || 'ag/gemini-3.8-flash-medium'}`
          }
        }
        const newToken = parts[1].trim()
        
        // BUG-20: Mask token in terminal output
        mainWindow?.webContents.send(IPC_CHANNELS.AGENT_STATUS, {
          type: 'system',
          message: '\x1b[90m[Command: /token ***]\x1b[0m'
        })
        
        agent.setToken(newToken, '9router')
        return {
          response: `\x1b[32m✔ 9router API token connected and saved!\x1b[0m\nEndpoint: http://localhost:20128/v1\nModel: ${agent.getConfig().providers['9router']?.model || 'ag/gemini-3.8-flash-medium'}`
        }
      }

      if (trimmed.startsWith('/model')) {
        const parts = trimmed.split(/\s+/)
        if (parts.length < 2) {
          const cfg = agent.getConfig()
          const p = cfg.providers['9router'] || {}
          const activeModel = agent.provider.model || p.model || 'ag/gemini-3.8-flash-medium'
          const hasToken = p.api_key && p.api_key.length > 0
          return {
            response: `\x1b[36m[9router Model Config]\x1b[0m\nActive Model   : \x1b[32m${activeModel}\x1b[0m\nProvider       : 9router (http://localhost:20128/v1)\nToken Status   : ${hasToken ? '\x1b[32mConnected (Bearer key aktif)\x1b[0m' : '\x1b[31mNo token set (/token <key>)\x1b[0m'}\n\n\x1b[33mUsage:\x1b[0m\n  /model <model-name>\n\n\x1b[33mContoh:\x1b[0m\n  /model vallen/contoh\n  /model ag/gemini-3.8-flash-medium\n  /model kr/claude-sonnet-4.5-thinking-agentic\n  /model cl/openai/gpt-6.1-sol-pro\n  /model kr/deepseek-3.2-thinking-agentic\n  /model cl/qwen/qwen3.8-max-prime`
          }
        }
        const newModel = parts.slice(1).join(' ').trim()
        agent.setModel(newModel)
        return {
          response: `\x1b[32m✔ Model updated to: ${newModel}\x1b[0m\nEndpoint: http://localhost:20128/v1 (via 9router Bearer token)`,
          updatedModel: newModel
        }
      }

      if (trimmed === '/skills') {
        const skills = agent.skillLoader.list()
        const byCat: Record<string, string[]> = {}
        for (const s of skills) {
          const cat = s.metadata.category || 'general'
          if (!byCat[cat]) byCat[cat] = []
          byCat[cat].push(s.name)
        }
        const lines = ['\x1b[36m[Available Skills]\x1b[0m']
        for (const [cat, sks] of Object.entries(byCat)) {
          lines.push(`\x1b[33m${cat}\x1b[0m: ${sks.join(', ')}`)
        }
        return { response: lines.join('\n') }
      }

      if (trimmed === '/tools') {
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

      if (trimmed === '/memory') {
        const mem = agent.memoryStore.formatForSystemPrompt()
        return {
          response: mem || '\x1b[33mNo persistent memories stored yet.\x1b[0m'
        }
      }

      if (trimmed === '/todos') {
        const td = agent.todoStore.formatForInjection()
        return {
          response: td || '\x1b[33mNo active todos in task list.\x1b[0m'
        }
      }

      if (trimmed === '/stop') {
        agent.interrupt()
        return {
          response: `\x1b[33m✔ Interrupt signal sent. Halting active agent execution.\x1b[0m`
        }
      }

      if (trimmed === '/sessions') {
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

      if (trimmed.startsWith('/resume')) {
        const parts = trimmed.split(/\s+/)
        if (parts.length < 2) {
          return { response: '\x1b[31mUsage: /resume <session-id>\x1b[0m (Use /sessions to list available IDs)' }
        }
        const targetId = parts[1].trim()
        const ok = agent.resumeSession(targetId)
        if (ok) {
          return {
            response: `\x1b[32m✔ Resumed session [${targetId}]\x1b[0m\nModel: ${agent.provider.model}\nWorking Directory: ${agent.config.terminal?.cwd || process.cwd()}`,
            updatedModel: agent.provider.model
          }
        } else {
          return { response: `\x1b[31mSession not found: ${targetId}\x1b[0m` }
        }
      }

      if (trimmed === '/new' || trimmed === '/reset') {
        agent.resetSession()
        return {
          response: `\x1b[32m✔ Session reset. Started fresh conversation context.\x1b[0m`
        }
      }

      if (trimmed === '/themes') {
        const themeList = configManager.listThemes()
        const currentCfg = configManager.loadConfig()
        const lines = ['\x1b[36m[Available Themes]\x1b[0m']
        for (const t of themeList) {
          const isCur = t.name === currentCfg.themeName
          lines.push(`${isCur ? '\x1b[32m▶ ' : '  '}\x1b[1m${t.name.padEnd(16)}\x1b[0m \x1b[2m(${t.displayName}${t.isBuiltIn ? '' : ' - Custom'})\x1b[0m${isCur ? ' \x1b[32m[Active]\x1b[0m' : ''}`)
        }
        lines.push(`\n\x1b[33mUsage:\x1b[0m /theme <name> (contoh: /theme synthwave)`)
        return { response: lines.join('\n') }
      }

      if (trimmed.startsWith('/theme')) {
        const parts = trimmed.split(/\s+/)
        if (parts.length < 2) {
          const currentCfg = configManager.loadConfig()
          return {
            response: `\x1b[36m[Active Theme]\x1b[0m: ${currentCfg.themeName}\n\x1b[33mUsage:\x1b[0m /theme <name>\n(Gunakan /themes untuk melihat daftar lengkap)`
          }
        }
        const targetTheme = parts[1].trim()
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
          response: `\x1b[32m✔ Direct Shell Mode Active (PTY).\x1b[0m\nDirect bash shell enabled.\nPress \x1b[33mCtrl+\`\x1b[0m or \x1b[33mCtrl+T\x1b[0m to return to AI Chat Mode.`,
          togglePty: true
        }
      }

      if (trimmed === '/help') {
        return {
          response: `\x1b[36m[Vallenatrix Autonomous AI Terminal Commands]\x1b[0m
/model <name>  - Switch active AI model (e.g. /model ag/gemini-3.8-flash-medium)
/token <key>   - Connect and persist 9router API key
/tools         - Inspect 16 registered tools across 12 toolsets
/skills        - Manage modular skills (search, install, toggle)
/themes        - List available UI color themes
/theme <name>  - Switch UI theme instantly
/stats         - Telemetry, context usage, and token latency
/memory        - Inspect persistent memory and user profile
/todos         - View active task list
/sessions      - List saved chat sessions
/resume <id>   - Resume a previous chat session
/stop          - Interrupt active running agent turn
/pty | /sh     - Enter direct PTY shell mode (hotkey: Ctrl+\` / Ctrl+T)
/new | /reset  - Start fresh conversation context
/clear         - Clear terminal display
/help          - Show this command reference`
        }
      }

      if (userModel) {
        agent.setModel(userModel)
      }

      // Live status callback through webContents send
      const callbacks = {
        onThinking: (status: string) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC_CHANNELS.AGENT_STATUS, { type: 'thinking', message: status })
          }
        },
        onToolStart: (info: any) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC_CHANNELS.AGENT_STATUS, { type: 'tool_start', message: info.preview })
          }
        },
        onToolEnd: (info: any) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC_CHANNELS.AGENT_STATUS, { type: 'tool_end', message: info.preview })
          }
        },
        onReviewComplete: (summary: string) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC_CHANNELS.AGENT_STATUS, { type: 'review_complete', message: `💾 Self-improvement: ${summary}` })
          }
        },
        onReviewError: (error: string) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            console.error('[Review] Background review error:', error)
          }
        }
      }

      const res = await agent.chat(message, callbacks)
      return {
        response: res.response,
        telemetry: {
          totalTokens: res.totalTokens,
          promptTokens: res.promptTokens,
          completionTokens: res.completionTokens,
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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  ptyManager.kill()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
