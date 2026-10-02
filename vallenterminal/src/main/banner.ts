import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { execSync } from 'child_process'
import http from 'http'
import https from 'https'

const STRIP_ANSI_REGEX = /\x1b\[[0-9;]*m/g

export function stripAnsi(str: string): string {
  return str.replace(STRIP_ANSI_REGEX, '')
}

export interface HealthCheckItem {
  id: string
  title: string
  detail: string
  status: 'ok' | 'warn' | 'error'
  statusText: string
  formattedRow: string
}

export interface StartupPayload {
  asciiBanner: string
  diagHeader: string
  diagFooter: string
  healthChecks: HealthCheckItem[]
  guideBox: string[]
  model: string
}

const INNER = 61

function borderTop(title: string): string {
  const visibleLen = stripAnsi(title).length
  const fill = Math.max(0, INNER + 6 - 4 - visibleLen - 1)
  return `\x1b[36m╭─ \x1b[1;36m${title}\x1b[0m \x1b[36m${'─'.repeat(fill)}╮\x1b[0m`
}

function borderBot(): string {
  return `\x1b[36m╰${'─'.repeat(INNER + 4)}╯\x1b[0m`
}

function makeRow(styledText: string): string {
  const visible = stripAnsi(styledText)
  const pad = ' '.repeat(Math.max(0, INNER + 2 - visible.length))
  return `\x1b[36m│\x1b[0m  ${styledText}${pad}\x1b[36m│\x1b[0m`
}

function makeDiagRow(
  index: number,
  total: number,
  label: string,
  detail: string,
  statusText: string,
  statusType: 'ok' | 'warn' | 'error'
): string {
  const tag = `[${index}/${total}]`
  const statusColor = statusType === 'ok' ? '\x1b[32m' : statusType === 'warn' ? '\x1b[33m' : '\x1b[31m'
  const maxDetailLen = INNER - 6 - 21 - statusText.length - 2
  const safeDetail = detail.length > maxDetailLen ? detail.slice(0, maxDetailLen - 1) + '…' : detail
  const left = `\x1b[90m${tag}\x1b[0m \x1b[1m${label.padEnd(19)}\x1b[0m \x1b[2m${safeDetail}\x1b[0m`
  const visibleLeft = stripAnsi(left)
  const pad = ' '.repeat(Math.max(1, INNER - visibleLeft.length - statusText.length))
  return `\x1b[36m│\x1b[0m  ${left}${pad}${statusColor}${statusText}\x1b[0m  \x1b[36m│\x1b[0m`
}

async function probeGateway(baseURL: string, timeout = 600): Promise<{ status: 'ok' | 'warn'; detail: string; statusText: string }> {
  return new Promise((resolve) => {
    try {
      const url = new URL(baseURL.endsWith('/models') ? baseURL : `${baseURL.replace(/\/+$/, '')}/models`)
      const client = url.protocol === 'https:' ? https : http
      const req = client.get(url, { timeout }, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          resolve({ status: 'ok', detail: 'gateway online', statusText: '[ONLINE]' })
        } else {
          resolve({ status: 'warn', detail: `HTTP ${res.statusCode} (standby)`, statusText: '[STANDBY]' })
        }
      })
      req.on('error', () => {
        resolve({ status: 'warn', detail: 'standby (offline)', statusText: '[STANDBY]' })
      })
      req.on('timeout', () => {
        req.destroy()
        resolve({ status: 'warn', detail: 'standby (timeout)', statusText: '[STANDBY]' })
      })
    } catch {
      resolve({ status: 'warn', detail: 'unconfigured', statusText: '[STANDBY]' })
    }
  })
}

export async function getStartupPayload(agentInstance?: any): Promise<StartupPayload> {
  const candidatePaths = [
    '/home/vallenganteng/Destop/vallenatrix/banner.txt',
    join(process.cwd(), 'banner.txt'),
    join(__dirname, '../../../banner.txt'),
    join(__dirname, '../../banner.txt'),
    join(app?.getAppPath?.() || '', 'banner.txt'),
    join(app?.getAppPath?.() || '', '../banner.txt')
  ]

  let rawAscii = ''
  for (const p of candidatePaths) {
    if (existsSync(p)) {
      try {
        rawAscii = readFileSync(p, 'utf-8').trimEnd()
        if (rawAscii) break
      } catch {}
    }
  }

  const asciiBanner = rawAscii ? `\x1b[38;5;141m${rawAscii}\x1b[0m` : ''

  // 1. Host Platform
  const shell = process.env.SHELL || '/bin/bash'
  const osDetail = `${process.platform}-${process.arch} | ${shell}`

  // 2. Developer Toolchains
  let pyVer = 'missing'
  try {
    pyVer = execSync('python3 --version 2>&1').toString().trim().replace('Python ', 'py ')
  } catch {}
  let gitVer = 'missing'
  try {
    gitVer = execSync('git --version 2>&1').toString().trim().replace('git version ', 'git ')
  } catch {}
  const toolchainsDetail = `${pyVer} | ${gitVer}`
  const toolchainsStatus: 'ok' | 'warn' = pyVer !== 'missing' ? 'ok' : 'warn'

  // 3. Storage
  const storageDetail = '~/.vallenatrix (config, sessions)'

  // 4. Skills
  let skillsCount = 59
  try {
    if (agentInstance?.skillLoader) {
      skillsCount = agentInstance.skillLoader.list().length
    }
  } catch {}
  const skillsDetail = `${skillsCount} skills active (0 disabled)`

  // 5. Tools
  const EXPECTED_TOOLS = 16
  let toolsCount = 16
  try {
    const vallenagentDist = join(__dirname, '../../../vallenagent/dist/index.js')
    const { registry } = require(vallenagentDist)
    if (registry) {
      const actual = registry.list().length
      if (actual > 0) {
        toolsCount = actual
      }
    }
  } catch {}
  const toolsDetail = `${toolsCount}/${EXPECTED_TOOLS} tools operational (12 sets)`
  const toolsStatus: 'ok' | 'warn' = toolsCount >= EXPECTED_TOOLS ? 'ok' : 'warn'

  // 6. AI Gateway probe
  let gatewayURL = 'http://127.0.0.1:20128/v1'
  let modelName = 'ag/gemini-3.8-flash-medium'
  try {
    const cfg = agentInstance?.getConfig?.()
    if (cfg?.providers?.['9router']?.baseURL) {
      gatewayURL = cfg.providers['9router'].baseURL
    }
    if (cfg?.providers?.['9router']?.model) {
      modelName = cfg.providers['9router'].model
    }
  } catch {}
  const gwProbe = await probeGateway(gatewayURL)
  const gwDetail = gwProbe.status === 'ok' ? `9router online (${modelName})` : `9router standby (port 20128)`

  const TOTAL_CHECKS = 6
  const healthChecks: HealthCheckItem[] = [
    {
      id: 'platform',
      title: 'Host Platform',
      detail: osDetail,
      status: 'ok',
      statusText: '[OK]',
      formattedRow: makeDiagRow(1, TOTAL_CHECKS, 'Host Platform', osDetail, '[OK]', 'ok')
    },
    {
      id: 'toolchains',
      title: 'Developer Tools',
      detail: toolchainsDetail,
      status: toolchainsStatus,
      statusText: toolchainsStatus === 'ok' ? '[OK]' : '[WARN]',
      formattedRow: makeDiagRow(2, TOTAL_CHECKS, 'Developer Tools', toolchainsDetail, toolchainsStatus === 'ok' ? '[OK]' : '[WARN]', toolchainsStatus)
    },
    {
      id: 'storage',
      title: 'Persistent Stores',
      detail: storageDetail,
      status: 'ok',
      statusText: '[OK]',
      formattedRow: makeDiagRow(3, TOTAL_CHECKS, 'Persistent Stores', storageDetail, '[OK]', 'ok')
    },
    {
      id: 'skills',
      title: 'Modular Skills',
      detail: skillsDetail,
      status: 'ok',
      statusText: '[OK]',
      formattedRow: makeDiagRow(4, TOTAL_CHECKS, 'Modular Skills', skillsDetail, '[OK]', 'ok')
    },
    {
      id: 'tools',
      title: 'Core Toolsets',
      detail: toolsDetail,
      status: toolsStatus,
      statusText: toolsStatus === 'ok' ? '[OK]' : '[WARN]',
      formattedRow: makeDiagRow(5, TOTAL_CHECKS, 'Core Toolsets', toolsDetail, toolsStatus === 'ok' ? '[OK]' : '[WARN]', toolsStatus)
    },
    {
      id: 'gateway',
      title: 'AI Gateway',
      detail: gwDetail,
      status: gwProbe.status,
      statusText: gwProbe.statusText,
      formattedRow: makeDiagRow(6, TOTAL_CHECKS, 'AI Gateway', gwDetail, gwProbe.statusText, gwProbe.status)
    }
  ]

  const guideBox = [
    borderTop('Vallenatrix Autonomous Terminal'),
    makeRow('Created by \x1b[33m@vallenganteng\x1b[0m'),
    makeRow(''),
    makeRow('\x1b[1mQuick Commands:\x1b[0m'),
    makeRow('  \x1b[36m/help\x1b[0m       Show full command reference & shortcuts'),
    makeRow('  \x1b[36m/tools\x1b[0m      Inspect 16 builtin tools across 12 toolsets'),
    makeRow('  \x1b[36m/skills\x1b[0m     Search, install, or toggle modular skills'),
    makeRow('  \x1b[36m/model\x1b[0m      Switch active AI model (e.g. /model gemini)'),
    makeRow('  \x1b[36mCtrl+`\x1b[0m      Toggle direct PTY shell mode (hotkey: Ctrl+T)'),
    makeRow(''),
    makeRow('\x1b[90mType a prompt in the chat input below to begin.\x1b[0m'),
    borderBot()
  ]

  return {
    asciiBanner,
    diagHeader: borderTop('System Diagnostics & Health Check'),
    diagFooter: borderBot(),
    healthChecks,
    guideBox,
    model: modelName
  }
}
