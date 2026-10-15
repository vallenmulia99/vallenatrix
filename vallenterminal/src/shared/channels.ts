export const IPC_CHANNELS = {
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_START: 'terminal:start',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_NEW: 'window:new',
  WINDOW_CLOSE_TERMINAL: 'window:close-terminal',
  WINDOW_SELECT: 'window:select',
  WINDOW_TABS: 'window:tabs',
  WINDOW_TABS_GET: 'window:tabs:get',
  TERMINAL_SWITCHED: 'terminal:switched',
  WINDOW_STATE_CHANGE: 'window:state-change',

  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',

  THEME_LIST: 'theme:list',
  THEME_GET: 'theme:get',
  THEME_SAVE: 'theme:save',

  MEDIA_SELECT: 'media:select',
  SYSTEM_OPEN_EXTERNAL: 'system:open-external',
  SYSTEM_BANNER: 'system:banner',

  AGENT_CHAT: 'agent:chat',
  AGENT_STATUS: 'agent:status',
  AGENT_APPROVAL: 'agent:approval',
  PASTE_SAVE: 'paste:save'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]
