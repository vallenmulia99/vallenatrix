// Config types mirroring Hermes structure
export interface ProviderConfig {
  base_url: string
  api_key: string
  model: string
  enabled: boolean
}

export interface AgentConfig {
  providers: {
    active: string
    [key: string]: string | ProviderConfig
  }
  max_iterations?: number
  skills?: {
    paths?: string[]
  }
  terminal?: {
    cwd?: string
  }
}

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
}
