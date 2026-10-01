export const IPC_CHANNELS = {
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_EXIT: 'terminal:exit',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_STATE_CHANGE: 'window:state-change',

  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',

  THEME_LIST: 'theme:list',
  THEME_GET: 'theme:get',
  THEME_SAVE: 'theme:save',

  MEDIA_SELECT: 'media:select',
  SYSTEM_OPEN_EXTERNAL: 'system:open-external',

  AGENT_CHAT: 'agent:chat',
  AGENT_STATUS: 'agent:status'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]
