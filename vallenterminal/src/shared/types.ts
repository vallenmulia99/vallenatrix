export interface ThemeColors {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
  foreground: string
  background: string
  cursor?: string
  cursorAccent?: string
  selectionBackground?: string
}

export type BackgroundType = 'none' | 'color' | 'image' | 'video'
export type BackgroundFit = 'cover' | 'contain' | 'fill' | 'none'

export interface BackgroundConfig {
  type: BackgroundType
  path: string
  dim: number // 0 to 1
  fit: BackgroundFit
  blur: number // px
  opacity: number // 0 to 1
}

export interface TerminalConfig {
  fontFamily: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
}

export interface Theme {
  name: string
  displayName?: string
  colors: ThemeColors
  backgroundPreset?: Partial<BackgroundConfig>
}

export interface AppConfig {
  themeName: string
  shell: string
  windowOpacity: number // 0 to 1
  autoPauseVideo: boolean
  background: BackgroundConfig
  terminal: TerminalConfig
}

export type WindowState = 'focus' | 'blur' | 'minimize' | 'restore'

export interface MediaSelectResult {
  canceled: boolean
  path?: string
  type?: 'image' | 'video'
}

export const DEFAULT_CONFIG: AppConfig = {
  themeName: 'cyber-sakura',
  shell: '',
  windowOpacity: 0.95,
  autoPauseVideo: true,
  background: {
    type: 'none',
    path: '',
    dim: 0.3,
    fit: 'cover',
    blur: 0,
    opacity: 0.8
  },
  terminal: {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', monospace",
    fontSize: 14,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 10000
  }
}

export const THEME_NAME_REGEX = /^[a-z0-9][a-z0-9-_]{0,63}$/

export function isValidThemeName(name: unknown): boolean {
  return typeof name === 'string' && THEME_NAME_REGEX.test(name)
}

export function validateTheme(raw: unknown): Theme | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (!isValidThemeName(obj.name)) return null
  if (!obj.colors || typeof obj.colors !== 'object') return null

  const colors = obj.colors as Record<string, unknown>
  const requiredColorKeys = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
    'foreground', 'background'
  ]

  for (const key of requiredColorKeys) {
    if (typeof colors[key] !== 'string') return null
  }

  const theme: Theme = {
    name: obj.name,
    displayName: typeof obj.displayName === 'string' ? obj.displayName : obj.name,
    colors: obj.colors as ThemeColors
  }

  if (obj.backgroundPreset && typeof obj.backgroundPreset === 'object') {
    theme.backgroundPreset = obj.backgroundPreset as Partial<BackgroundConfig>
  }

  return theme
}

export function sanitizeConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG }
  const obj = raw as Partial<AppConfig>

  return {
    themeName: typeof obj.themeName === 'string' && obj.themeName ? obj.themeName : DEFAULT_CONFIG.themeName,
    shell: typeof obj.shell === 'string' ? obj.shell : DEFAULT_CONFIG.shell,
    windowOpacity: typeof obj.windowOpacity === 'number' ? Math.max(0.1, Math.min(1, obj.windowOpacity)) : DEFAULT_CONFIG.windowOpacity,
    autoPauseVideo: typeof obj.autoPauseVideo === 'boolean' ? obj.autoPauseVideo : DEFAULT_CONFIG.autoPauseVideo,
    background: {
      type: ['none', 'color', 'image', 'video'].includes(obj.background?.type as string) ? obj.background!.type : DEFAULT_CONFIG.background.type,
      path: typeof obj.background?.path === 'string' ? obj.background.path : DEFAULT_CONFIG.background.path,
      dim: typeof obj.background?.dim === 'number' ? Math.max(0, Math.min(1, obj.background.dim)) : DEFAULT_CONFIG.background.dim,
      fit: ['cover', 'contain', 'fill', 'none'].includes(obj.background?.fit as string) ? obj.background!.fit : DEFAULT_CONFIG.background.fit,
      blur: typeof obj.background?.blur === 'number' ? Math.max(0, Math.min(50, obj.background.blur)) : DEFAULT_CONFIG.background.blur,
      opacity: typeof obj.background?.opacity === 'number' ? Math.max(0, Math.min(1, obj.background.opacity)) : DEFAULT_CONFIG.background.opacity
    },
    terminal: {
      fontFamily: typeof obj.terminal?.fontFamily === 'string' && obj.terminal.fontFamily ? obj.terminal.fontFamily : DEFAULT_CONFIG.terminal.fontFamily,
      fontSize: typeof obj.terminal?.fontSize === 'number' ? Math.max(8, Math.min(48, obj.terminal.fontSize)) : DEFAULT_CONFIG.terminal.fontSize,
      lineHeight: typeof obj.terminal?.lineHeight === 'number' ? Math.max(0.8, Math.min(3, obj.terminal.lineHeight)) : DEFAULT_CONFIG.terminal.lineHeight,
      letterSpacing: typeof obj.terminal?.letterSpacing === 'number' ? Math.max(-2, Math.min(10, obj.terminal.letterSpacing)) : DEFAULT_CONFIG.terminal.letterSpacing,
      cursorStyle: ['block', 'underline', 'bar'].includes(obj.terminal?.cursorStyle as string) ? obj.terminal!.cursorStyle : DEFAULT_CONFIG.terminal.cursorStyle,
      cursorBlink: typeof obj.terminal?.cursorBlink === 'boolean' ? obj.terminal.cursorBlink : DEFAULT_CONFIG.terminal.cursorBlink,
      scrollback: typeof obj.terminal?.scrollback === 'number' ? Math.max(100, Math.min(100000, obj.terminal.scrollback)) : DEFAULT_CONFIG.terminal.scrollback
    }
  }
}
