export type TelegramApprovalMode = 'dangerous' | 'all' | 'off'

export interface TelegramPairingState {
  /** SHA-256 hex of the pairing code. Plaintext is never stored. */
  code_hash: string
  expires_at: number
  attempts: number
}

export interface TelegramGatewayConfig {
  token?: string
  allowlist: number[]
  last_update_id: number
  approval: TelegramApprovalMode
  pairing?: TelegramPairingState
  last_error?: string
  bot_username?: string
}

export interface GatewayAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  send(chatId: number | string, text: string): Promise<void>
  status(): Promise<Record<string, unknown>>
}
