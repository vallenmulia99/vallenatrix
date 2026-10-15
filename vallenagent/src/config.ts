import { logger } from './logger'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AgentConfig, ProviderConfig } from './types'

export const DEFAULT_CONFIG: AgentConfig = {
  providers: {
    active: '9router',
    '9router': {
      base_url: 'http://127.0.0.1:20128/v1',
      api_key: '',
      model: 'ag/gemini-3.8-flash-medium',
      enabled: true
    }
  },
  max_iterations: 500,
  max_tokens_per_turn: 400_000,
  gateway: {
    background_review: false,
    background_review_interval: 5,
    telegram: { approval: 'dangerous', max_iterations: 60, turn_timeout_ms: 900_000 }
  },
  skills: {
    paths: [
      join(getVallenatrixHome(), 'skills')
    ],
    disabled: [],
    enabled: []
  },
  terminal: {
    cwd: process.cwd()
  }
}

export function getVallenatrixHome(): string {
  if (process.env.VALLENATRIX_HOME) return process.env.VALLENATRIX_HOME
  return join(homedir(), '.vallenatrix')
}

function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2))
  }
  if (path.startsWith('$VALLENATRIX_HOME/')) {
    return join(getVallenatrixHome(), path.slice(18))
  }
  return path
}

export function loadConfig(): AgentConfig {
  const home = getVallenatrixHome()
  const configPath = join(home, 'config.json')
  
  if (!existsSync(configPath)) {
    return { ...structuredClone(DEFAULT_CONFIG), skills: { ...DEFAULT_CONFIG.skills, paths: [join(home, 'skills')] }, terminal: { cwd: process.cwd() } }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const userConfig = JSON.parse(raw)
    
    // Deep merge with defaults
    const merged: AgentConfig = {
      ...DEFAULT_CONFIG,
      ...userConfig,
      providers: {
        ...DEFAULT_CONFIG.providers,
        ...userConfig.providers
      },
      skills: {
        ...DEFAULT_CONFIG.skills,
        paths: [join(home, 'skills')],
        ...userConfig.skills
      },
      gateway: {
        ...DEFAULT_CONFIG.gateway,
        ...userConfig.gateway,
        telegram: {
          ...DEFAULT_CONFIG.gateway?.telegram,
          ...userConfig.gateway?.telegram
        }
      },
      // BUG-10: Always use current cwd, never persisted value
      terminal: {
        cwd: process.cwd()
      }
    }

    if (merged.skills?.paths) {
      merged.skills.paths = merged.skills.paths.map(expandPath)
    }

    return merged
  } catch (err) {
    logger.error('[Config] Failed to load, using defaults:', err)
    return { ...structuredClone(DEFAULT_CONFIG), terminal: { cwd: process.cwd() } }
  }
}

export function saveConfig(updates: Partial<AgentConfig>): AgentConfig {
  const current = loadConfig()
  const home = getVallenatrixHome()
  const configPath = join(home, 'config.json')

  const updated: AgentConfig = {
    ...current,
    ...updates,
    providers: {
      ...current.providers,
      ...(updates.providers || {})
    },
    skills: {
      ...current.skills,
      ...(updates.skills || {})
    },
    gateway: {
      ...current.gateway,
      ...(updates.gateway || {}),
      telegram: {
        ...current.gateway?.telegram,
        ...(updates.gateway?.telegram || {})
      }
    }
    // BUG-10: Never persist terminal.cwd (runtime state)
  }

  mkdirSync(home, { recursive: true })
  chmodSync(home, 0o700)
  
  // BUG-10: Write config with 0600 permissions (API keys inside)
  const existingConfig = existsSync(configPath)
  if (existingConfig) {
    const oldContent = readFileSync(configPath, 'utf-8')
    try {
      const parsed = JSON.parse(oldContent)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Config root must be an object')
    } catch {
      let suffix = 0
      let corruptPath: string
      do {
        corruptPath = `${configPath}.corrupt-${Date.now()}${suffix ? `-${suffix}` : ''}`
        suffix++
      } while (existsSync(corruptPath))
      renameSync(configPath, corruptPath)
      logger.warn(`[Config] Invalid config quarantined at ${corruptPath}; save aborted to protect existing settings and backup.`)
      throw new Error(`Refusing to overwrite corrupt config; inspect ${corruptPath} and restore or remove it first.`)
    }
    // Secure legacy config before copying secrets into backup.
    chmodSync(configPath, 0o600)
    // Backup only valid config, never overwrite known-good backup with corrupt bytes.
    const backupPath = configPath + '.bak'
    writeFileSync(backupPath, oldContent, { mode: 0o600 })
  }
  
  const { terminal: _runtimeTerminal, ...persisted } = updated
  const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, JSON.stringify(persisted, null, 2), { mode: 0o600 })
  chmodSync(tmpPath, 0o600)
  renameSync(tmpPath, configPath)
  return updated
}

export function setProviderToken(providerName: string, apiKey: string): AgentConfig {
  const current = loadConfig()
  const provider = current.providers[providerName] as ProviderConfig | undefined
  if (!provider || typeof provider === 'string') {
    current.providers[providerName] = {
      base_url: 'http://localhost:20128/v1',
      api_key: apiKey,
      model: 'ag/gemini-3.8-flash-medium',
      enabled: true
    }
  } else {
    provider.api_key = apiKey
    provider.enabled = true
  }
  return saveConfig(current)
}

export function getActiveProvider(config: AgentConfig): { name: string } & ProviderConfig {
  const activeName = config.providers.active
  const provider = config.providers[activeName]
  
  if (!provider || typeof provider === 'string') {
    throw new Error(`Active provider "${activeName}" not found in config`)
  }
  
  if (!provider.enabled) {
    throw new Error(`Provider "${activeName}" is disabled`)
  }
  
  return { name: activeName, ...provider }
}
