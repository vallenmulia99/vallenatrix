import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getVallenatrixHome } from '../config'
import type { TelegramGatewayConfig } from './types'

const DEFAULTS: TelegramGatewayConfig = { allowlist: [], last_update_id: 0, approval: 'dangerous' }

export function gatewayDir(): string {
  const dir = join(getVallenatrixHome(), 'gateway')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  return dir
}

export function telegramConfigPath(): string {
  return join(gatewayDir(), 'telegram.json')
}

export function loadTelegramConfig(): TelegramGatewayConfig {
  const path = telegramConfigPath()
  if (!existsSync(path)) return structuredClone(DEFAULTS)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<TelegramGatewayConfig>
    return {
      ...DEFAULTS,
      ...raw,
      allowlist: Array.isArray(raw.allowlist) ? [...new Set(raw.allowlist.filter(id => Number.isSafeInteger(id) && id > 0))] : [],
      last_update_id: Number.isSafeInteger(raw.last_update_id) && (raw.last_update_id ?? -1) >= 0 ? raw.last_update_id! : 0,
      approval: raw.approval === 'all' || raw.approval === 'off' ? raw.approval : 'dangerous'
    }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

export function saveTelegramConfig(config: TelegramGatewayConfig): void {
  const path = telegramConfigPath()
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, path)
  chmodSync(path, 0o600)
}

export function updateTelegramConfig(update: Partial<TelegramGatewayConfig>): TelegramGatewayConfig {
  const next = { ...loadTelegramConfig(), ...update }
  saveTelegramConfig(next)
  return next
}

export function writeTelegramOffsetBeforeHandling(updateId: number): void {
  const config = loadTelegramConfig()
  if (updateId >= config.last_update_id) {
    config.last_update_id = updateId + 1
    saveTelegramConfig(config)
  }
}
