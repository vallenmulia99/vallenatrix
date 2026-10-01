import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { IPC_CHANNELS } from '../shared/channels'
import { PtyManager } from './pty'
import { ConfigManager } from './config'
import { registerMediaProtocol, selectMediaFile } from './media'

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
