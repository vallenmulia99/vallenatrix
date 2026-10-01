import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/channels'
import { AppConfig, Theme, WindowState, MediaSelectResult } from '../shared/types'

const api = {
  onTerminalData: (callback: (data: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: string): void => callback(data)
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_DATA, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_DATA, listener)
  },

  sendTerminalData: (data: string): void => {
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_INPUT, data)
  },

  resizeTerminal: (cols: number, rows: number): void => {
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_RESIZE, { cols, rows })
  },

  onTerminalExit: (callback: (code: number) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, code: number): void => callback(code)
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_EXIT, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_EXIT, listener)
  },

  minimizeWindow: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE)
  },

  maximizeWindow: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE)
  },

  closeWindow: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE)
  },

  selectMedia: (): Promise<MediaSelectResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MEDIA_SELECT)
  },

  getConfig: (): Promise<AppConfig> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET)
  },

  saveConfig: (config: Partial<AppConfig>): Promise<AppConfig> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, config)
  },

  listThemes: (): Promise<Array<{ name: string; displayName: string; isBuiltIn: boolean }>> => {
    return ipcRenderer.invoke(IPC_CHANNELS.THEME_LIST)
  },

  getTheme: (name: string): Promise<Theme | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.THEME_GET, name)
  },

  saveTheme: (theme: Theme): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.THEME_SAVE, theme)
  },

  onWindowStateChange: (callback: (state: WindowState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: WindowState): void => callback(state)
    ipcRenderer.on(IPC_CHANNELS.WINDOW_STATE_CHANGE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_STATE_CHANGE, listener)
  }
}

export type VallenApi = typeof api

contextBridge.exposeInMainWorld('api', api)
