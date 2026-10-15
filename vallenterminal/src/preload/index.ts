import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/channels'
import { AppConfig, Theme, WindowState, MediaSelectResult } from '../shared/types'

const api = {
  onTerminalData: (callback: (payload: { terminalId: string; data: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { terminalId: string; data: string }): void => callback(payload)
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_DATA, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_DATA, listener)
  },

  sendTerminalData: (data: string): void => {
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_INPUT, data)
  },

  resizeTerminal: (cols: number, rows: number): void => {
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_RESIZE, { cols, rows })
  },

  startPty: (): void => ipcRenderer.send(IPC_CHANNELS.TERMINAL_START),

  onTerminalExit: (callback: (payload: { terminalId: string; code: number }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { terminalId: string; code: number }): void => callback(payload)
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

  newTerminal: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_NEW)
  },

  closeTerminal: (terminalId: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE_TERMINAL, terminalId)
  },

  selectTerminal: (terminalId: string): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_SELECT, terminalId)
  },

  getTerminals: (): Promise<{ windows: Array<{ id: string; label: string }>; activeId: string; output: string; label: string; model: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TABS_GET)
  },

  onTerminals: (callback: (data: { windows: Array<{ id: string; label: string }>; activeId: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { windows: Array<{ id: string; label: string }>; activeId: string }): void => callback(data)
    ipcRenderer.on(IPC_CHANNELS.WINDOW_TABS, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_TABS, listener)
  },

  onTerminalSwitched: (callback: (data: { terminalId: string; label: string; output: string; model: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { terminalId: string; label: string; output: string; model: string }): void => callback(data)
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_SWITCHED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_SWITCHED, listener)
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

  openExternal: (url: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, url)
  },

  getBanner: (): Promise<any> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_BANNER)
  },

  onWindowStateChange: (callback: (state: WindowState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: WindowState): void => callback(state)
    ipcRenderer.on(IPC_CHANNELS.WINDOW_STATE_CHANGE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_STATE_CHANGE, listener)
  },

  savePastedText: (text: string): Promise<{ path: string; lines: number; characters: number }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.PASTE_SAVE, text)
  },

  chatAgent: (message: string, model?: string, terminalId?: string): Promise<{
    response?: string
    error?: string
    telemetry?: any
    updatedModel?: string
    themeChange?: string
    togglePty?: boolean
  }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_CHAT, { message, model, terminalId })
  },

  answerApproval: (allowed: boolean, approvalId: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_APPROVAL, { allowed, approvalId })
  },

  onAgentStatus: (callback: (status: { type: string; message: string; id?: string; terminalId?: string; command?: string; stream?: 'stdout' | 'stderr'; chunk?: string; approvalId?: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: { type: string; message: string; id?: string; terminalId?: string; command?: string; stream?: 'stdout' | 'stderr'; chunk?: string; approvalId?: string }): void => callback(status)
    ipcRenderer.on(IPC_CHANNELS.AGENT_STATUS, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_STATUS, listener)
  }
}

export type VallenApi = typeof api

contextBridge.exposeInMainWorld('api', api)
