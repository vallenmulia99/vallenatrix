import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
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
  skills: {
    paths: [
      join(homedir(), '.vallenatrix', 'skills'),
      '/home/vallenganteng/Destop/vallenatrix/.vallenatrix/skills'
    ]
  },
  terminal: {
    cwd: process.cwd()
  }
}

export function getVallenatrixHome(): string {
  if (process.env.VALLENATRIX_HOME) return process.env.VALLENATRIX_HOME
  const localProject = join(process.cwd(), '.vallenatrix')
  if (existsSync(localProject)) return localProject
  const defaultDir = '/home/vallenganteng/Destop/vallenatrix/.vallenatrix'
  if (existsSync(defaultDir)) return defaultDir
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
    return DEFAULT_CONFIG
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
        ...userConfig.skills
      },
      terminal: {
        ...DEFAULT_CONFIG.terminal,
        ...userConfig.terminal
      }
    }

    if (merged.skills?.paths) {
      merged.skills.paths = merged.skills.paths.map(expandPath)
    }

    return merged
  } catch (err) {
    console.error('[Config] Failed to load, using defaults:', err)
    return DEFAULT_CONFIG
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
    terminal: {
      ...current.terminal,
      ...(updates.terminal || {})
    }
  }

  mkdirSync(home, { recursive: true })
  writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8')
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
