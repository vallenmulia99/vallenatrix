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
  /** Budget of OUTPUT (completion) tokens per user turn. Prompt tokens are not counted. */
  max_tokens_per_turn?: number
  /** Cap for max_tokens on a single provider request (default 16384). */
  max_output_tokens?: number
  /** Sampling temperature sent to the provider. Unset = provider/router default. 0-0.3 is recommended for coding. */
  temperature?: number
  context_windows?: Record<string, number>
  /** Context window assumed for models missing from context_windows (default 128000). */
  default_context_window?: number
  skills?: {
    paths?: string[]
    disabled?: string[]
    enabled?: string[]
  }
  terminal?: {
    cwd?: string
  }
  gateway?: {
    background_review?: boolean
    background_review_interval?: number
    telegram?: {
      approval?: 'dangerous' | 'all' | 'off'
      max_iterations?: number
      turn_timeout_ms?: number
    }
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
