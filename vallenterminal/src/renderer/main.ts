import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { VallenApi } from '../preload/index'
import type { AppConfig, Theme } from '../shared/types'
import { TerminalPet } from './pet'

declare global {
  interface Window {
    api: VallenApi
  }
}

let activeConfig: AppConfig

// DOM Elements
const videoEl = document.getElementById('bg-video') as HTMLVideoElement
const imageEl = document.getElementById('bg-image') as HTMLDivElement
const overlayEl = document.getElementById('overlay-layer') as HTMLDivElement

const settingsPanel = document.getElementById('settings-panel') as HTMLDivElement
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement
const btnSettingsClose = document.getElementById('btn-settings-close') as HTMLButtonElement

const btnMinimize = document.getElementById('btn-minimize') as HTMLButtonElement
const btnMaximize = document.getElementById('btn-maximize') as HTMLButtonElement
const btnClose = document.getElementById('btn-close') as HTMLButtonElement

// Settings controls
const selTheme = document.getElementById('setting-theme') as HTMLSelectElement
const selBgType = document.getElementById('setting-bg-type') as HTMLSelectElement
const selBgFit = document.getElementById('setting-bg-fit') as HTMLSelectElement
const sliderDim = document.getElementById('setting-dim') as HTMLInputElement
const sliderMediaOpacity = document.getElementById('setting-media-opacity') as HTMLInputElement
const sliderWinOpacity = document.getElementById('setting-win-opacity') as HTMLInputElement
const sliderBlur = document.getElementById('setting-blur') as HTMLInputElement
const chkAutoPause = document.getElementById('setting-autopause') as HTMLInputElement
const chkPetToggle = document.getElementById('setting-pet-toggle') as HTMLInputElement
const sliderPetScale = document.getElementById('setting-pet-scale') as HTMLInputElement
const labelPetScale = document.getElementById('label-pet-scale-val') as HTMLSpanElement
const settingPetScaleContainer = document.getElementById('setting-pet-scale-container') as HTMLDivElement

const btnChooseFile = document.getElementById('btn-choose-file') as HTMLButtonElement
const btnClearFile = document.getElementById('btn-clear-file') as HTMLButtonElement
const filePathDisplay = document.getElementById('file-path-display') as HTMLDivElement

const settingFileContainer = document.getElementById('setting-file-container') as HTMLDivElement
const settingFitContainer = document.getElementById('setting-fit-container') as HTMLDivElement
const settingOpacityContainer = document.getElementById('setting-opacity-container') as HTMLDivElement
const settingAutoPauseContainer = document.getElementById('setting-autopause-container') as HTMLDivElement

const labelDim = document.getElementById('label-dim-val') as HTMLSpanElement
const labelMediaOpacity = document.getElementById('label-media-opacity-val') as HTMLSpanElement
const labelWinOpacity = document.getElementById('label-win-opacity-val') as HTMLSpanElement
const labelBlur = document.getElementById('label-blur-val') as HTMLSpanElement
const labelFontSize = document.getElementById('label-font-size-val') as HTMLSpanElement

const btnFontDec = document.getElementById('btn-font-dec') as HTMLButtonElement
const btnFontInc = document.getElementById('btn-font-inc') as HTMLButtonElement
const btnFontReset = document.getElementById('btn-font-reset') as HTMLButtonElement
const btnSaveSettings = document.getElementById('btn-save-settings') as HTMLButtonElement
const saveNotification = document.getElementById('save-notification') as HTMLDivElement

// Agent color pickers
const colorToolPreparing = document.getElementById('setting-color-tool-preparing') as HTMLInputElement
const colorToolSuccess = document.getElementById('setting-color-tool-success') as HTMLInputElement
const colorAgentResponse = document.getElementById('setting-color-agent-response') as HTMLInputElement
const colorError = document.getElementById('setting-color-error') as HTMLInputElement

// Chat input elements
const chatInput = document.getElementById('chat-input') as HTMLInputElement
const btnSendChat = document.getElementById('btn-send-chat') as HTMLButtonElement
const modelSelect = document.getElementById('model-select') as HTMLSelectElement
const statusProgress = document.getElementById('status-progress') as HTMLSpanElement
const statusContext = document.getElementById('status-context') as HTMLSpanElement
const statusBarVisual = document.getElementById('status-bar-visual') as HTMLSpanElement
const statusTelemetry = document.getElementById('status-telemetry') as HTMLSpanElement

// Setup Terminal
const term = new Terminal({
  allowTransparency: true,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', monospace",
  fontSize: 14,
  fontWeight: '600',
  fontWeightBold: '700',
  lineHeight: 1.2,
  cursorBlink: true,
  cursorStyle: 'block',
  theme: {
    background: 'rgba(0, 0, 0, 0)',
    foreground: '#ffffff'
  }
})

const fitAddon = new FitAddon()
const webLinksAddon = new WebLinksAddon((_event, uri) => {
  window.api.openExternal(uri)
})
term.loadAddon(fitAddon)
term.loadAddon(webLinksAddon)

const terminalContainer = document.getElementById('terminal')!
term.open(terminalContainer)

// Initialize Terminal Pet
const pet = new TerminalPet(document.getElementById('terminal-container')!)

// Initial Fit
requestAnimationFrame(() => {
  fitAddon.fit()
  window.api.resizeTerminal(term.cols, term.rows)
})

let isDirectPtyMode = false
let hasEnteredPty = false

function updateStatus(
  text: string,
  type: 'idle' | 'thinking' | 'tool' | 'tool_end' | 'done' | 'boot' | 'pty' = 'idle',
  detail?: string
): void {
  statusProgress.textContent = text
  if (pet.isEnabled()) {
    pet.setAgentStatus(text, type, detail)
  }
}

function togglePtyMode(force?: boolean): void {
  isDirectPtyMode = force !== undefined ? force : !isDirectPtyMode
  const statusSymbol = document.querySelector('.status-symbol') as HTMLElement

  if (isDirectPtyMode) {
    if (statusSymbol) {
      statusSymbol.textContent = '💻'
      statusSymbol.title = 'Direct PTY Shell Active (Ctrl+` to switch back to AI)'
    }
    updateStatus('PTY Shell Active', 'pty')
    term.focus()
    if (!hasEnteredPty) {
      hasEnteredPty = true
      term.write('\r\n')
      window.api.sendTerminalData('\r')
    }
  } else {
    if (statusSymbol) {
      statusSymbol.textContent = '☤'
      statusSymbol.title = 'Vallenatrix AI Agent Active (Ctrl+` to switch to PTY)'
    }
    updateStatus('Ready', 'idle')
    chatInput.focus()
  }
}

// Two-way PTY Communication
term.onData((data) => {
  if (isDirectPtyMode) {
    window.api.sendTerminalData(data)
    pet.onUserActivity()
  }
})

window.api.onTerminalData((data) => {
  if (isDirectPtyMode) {
    term.write(data)
  }
})

const titlebarEl = document.getElementById('titlebar') as HTMLDivElement

// Double click titlebar to toggle maximize
titlebarEl.addEventListener('dblclick', (e) => {
  // Ignore clicks on control buttons
  const target = e.target as HTMLElement
  if (target.closest('.titlebar-controls')) return
  window.api.maximizeWindow()
})

// Debounced terminal fit & resize for smooth performance and lower CPU
let resizeTimeout: number | null = null
window.addEventListener('resize', () => {
  if (resizeTimeout) cancelAnimationFrame(resizeTimeout)
  resizeTimeout = requestAnimationFrame(() => {
    fitAddon.fit()
    window.api.resizeTerminal(term.cols, term.rows)
    resizeTimeout = null
  })
})

// Window Controls
btnMinimize.addEventListener('click', () => window.api.minimizeWindow())
btnMaximize.addEventListener('click', () => window.api.maximizeWindow())
btnClose.addEventListener('click', () => window.api.closeWindow())

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl+Shift+R: Refresh UI
  if (e.ctrlKey && e.shiftKey && e.key === 'R') {
    e.preventDefault()
    window.location.reload()
    return
  }

  // Ctrl+` or Ctrl+T: Toggle between AI Chat Mode and Direct PTY Shell Mode
  if ((e.ctrlKey && e.key === '`') || (e.ctrlKey && e.key === 't')) {
    e.preventDefault()
    togglePtyMode()
    return
  }

  // If in direct PTY shell mode, allow all typing directly to xterm
  if (isDirectPtyMode) {
    return
  }

  // Block typing outside chat input (except terminal and settings)
  const target = e.target as HTMLElement
  const isChatInput = target === chatInput || target.id === 'chat-input'
  const isSettingsInput = settingsPanel.contains(target) && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
  const isTerminalArea = target.classList.contains('xterm') || target.closest('.xterm') !== null
  
  // Block printable keys outside allowed areas
  if (!isChatInput && !isSettingsInput && !isTerminalArea) {
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
})

// Enable context menu on terminal for copy
terminalContainer.addEventListener('contextmenu', (e) => {
  const selection = term.getSelection()
  if (selection) {
    e.preventDefault()
    navigator.clipboard.writeText(selection)
  }
})

// Helper to construct vallen-media URL
function getMediaUrl(filePath: string): string {
  if (!filePath) return ''
  return `vallen-media://local${encodeURI(filePath)}`
}

// Apply Background & Overlay
function applyBackground(): void {
  const bg = activeConfig.background

  // Dim overlay
  overlayEl.style.backgroundColor = `rgba(15, 17, 23, ${bg.dim})`
  overlayEl.style.backdropFilter = bg.blur > 0 ? `blur(${bg.blur}px)` : 'none'
  overlayEl.style.opacity = activeConfig.windowOpacity.toString()

  // Window body stays fully opaque so text is never transparent
  document.body.style.opacity = '1'

  // Reset layers
  videoEl.style.display = 'none'
  imageEl.style.display = 'none'
  videoEl.pause()

  if (bg.type === 'video' && bg.path) {
    const url = getMediaUrl(bg.path)
    if (videoEl.src !== url) {
      videoEl.src = url
    }
    videoEl.style.display = 'block'
    videoEl.style.opacity = bg.opacity.toString()
    videoEl.style.objectFit = bg.fit === 'fill' ? 'fill' : bg.fit
    videoEl.play().catch(() => {})
  } else if (bg.type === 'image' && bg.path) {
    const url = getMediaUrl(bg.path)
    imageEl.style.display = 'block'
    imageEl.style.opacity = bg.opacity.toString()
    imageEl.style.backgroundImage = `url("${url}")`
    imageEl.style.backgroundSize = bg.fit === 'fill' ? '100% 100%' : bg.fit
  }
}

// Apply Theme
function applyTheme(theme: Theme): void {
  term.options.theme = {
    background: 'rgba(0, 0, 0, 0)',
    foreground: theme.colors.foreground || '#ffffff',
    cursor: theme.colors.cursor || '#ffffff',
    cursorAccent: theme.colors.cursorAccent || '#000000',
    selectionBackground: theme.colors.selectionBackground || 'rgba(255, 255, 255, 0.2)',
    black: theme.colors.black,
    red: theme.colors.red,
    green: theme.colors.green,
    yellow: theme.colors.yellow,
    blue: theme.colors.blue,
    magenta: theme.colors.magenta,
    cyan: theme.colors.cyan,
    white: theme.colors.white || '#ffffff',
    brightBlack: theme.colors.brightBlack,
    brightRed: theme.colors.brightRed,
    brightGreen: theme.colors.brightGreen,
    brightYellow: theme.colors.brightYellow,
    brightBlue: theme.colors.brightBlue,
    brightMagenta: theme.colors.brightMagenta,
    brightCyan: theme.colors.brightCyan,
    brightWhite: theme.colors.brightWhite || '#ffffff'
  }
}

// Font Zoom Helpers
function setFontSize(newSize: number): void {
  const clamped = Math.max(8, Math.min(36, newSize))
  activeConfig.terminal.fontSize = clamped
  term.options.fontSize = clamped
  labelFontSize.textContent = `${clamped}px`
  fitAddon.fit()
  window.api.resizeTerminal(term.cols, term.rows)
  window.api.saveConfig({ terminal: activeConfig.terminal })
}

// Keyboard Shortcuts
window.addEventListener('keydown', async (e) => {
  // Settings shortcut: Ctrl+,
  if (e.ctrlKey && e.key === ',') {
    e.preventDefault()
    toggleSettings()
    return
  }

  // Zoom shortcuts
  if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
    e.preventDefault()
    setFontSize(activeConfig.terminal.fontSize + 1)
    return
  }
  if (e.ctrlKey && e.key === '-') {
    e.preventDefault()
    setFontSize(activeConfig.terminal.fontSize - 1)
    return
  }
  if (e.ctrlKey && e.key === '0') {
    e.preventDefault()
    setFontSize(14)
    return
  }

  // Copy / Paste shortcuts
  if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
    e.preventDefault()
    const selection = term.getSelection()
    if (selection) {
      await navigator.clipboard.writeText(selection)
    }
    return
  }

  // Paste shortcut: in direct PTY mode send to shell, otherwise focus chat input
  if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
    e.preventDefault()
    if (isDirectPtyMode) {
      try {
        const text = await navigator.clipboard.readText()
        if (text) window.api.sendTerminalData(text)
      } catch {}
    } else {
      chatInput.focus()
    }
    return
  }
})

// Copy on selection change automatically
term.onSelectionChange(() => {
  const selection = term.getSelection()
  if (selection && selection.trim().length > 0) {
    navigator.clipboard.writeText(selection).catch(() => {})
  }
})

// Middle-click paste disabled (terminal read-only)
terminalContainer.addEventListener('auxclick', (e) => {
  if (e.button === 1) {
    e.preventDefault()
  }
})

// Auto pause video on minimize/blur
window.api.onWindowStateChange((state) => {
  if (state === 'minimize') {
    pet.setEnabled(false)
  } else if (state === 'restore' || state === 'focus') {
    if (chkPetToggle.checked) pet.setEnabled(true)
  }

  if (!activeConfig.autoPauseVideo || activeConfig.background.type !== 'video') return

  if (state === 'minimize' || state === 'blur') {
    videoEl.pause()
  } else if (state === 'focus' || state === 'restore') {
    videoEl.play().catch(() => {})
  }
})

// Settings Panel logic
function toggleSettings(): void {
  settingsPanel.classList.toggle('open')
}

btnSettings.addEventListener('click', toggleSettings)
btnSettingsClose.addEventListener('click', toggleSettings)

// Update Settings UI inputs with active config
function updateSettingsForm(): void {
  selTheme.value = activeConfig.themeName
  selBgType.value = activeConfig.background.type
  selBgFit.value = activeConfig.background.fit

  sliderDim.value = Math.round(activeConfig.background.dim * 100).toString()
  labelDim.textContent = `${sliderDim.value}%`

  sliderMediaOpacity.value = Math.round(activeConfig.background.opacity * 100).toString()
  labelMediaOpacity.textContent = `${sliderMediaOpacity.value}%`

  sliderWinOpacity.value = Math.round(activeConfig.windowOpacity * 100).toString()
  labelWinOpacity.textContent = `${sliderWinOpacity.value}%`

  sliderBlur.value = activeConfig.background.blur.toString()
  labelBlur.textContent = `${activeConfig.background.blur}px`

  chkAutoPause.checked = activeConfig.autoPauseVideo
  chkPetToggle.checked = pet.isEnabled()
  sliderPetScale.value = Math.round(pet.getScale() * 100).toString()
  labelPetScale.textContent = `${sliderPetScale.value}%`
  settingPetScaleContainer.style.display = pet.isEnabled() ? 'flex' : 'none'
  labelFontSize.textContent = `${activeConfig.terminal.fontSize}px`

  filePathDisplay.textContent = activeConfig.background.path || 'Belum ada file dipilih'

  const showMedia = activeConfig.background.type === 'image' || activeConfig.background.type === 'video'
  settingFileContainer.style.display = showMedia ? 'flex' : 'none'
  settingFitContainer.style.display = showMedia ? 'flex' : 'none'
  settingOpacityContainer.style.display = showMedia ? 'flex' : 'none'
  settingAutoPauseContainer.style.display = activeConfig.background.type === 'video' ? 'flex' : 'none'
}

// Bind Settings Input Listeners
selTheme.addEventListener('change', async () => {
  const themeName = selTheme.value
  const theme = await window.api.getTheme(themeName)
  if (theme) {
    applyTheme(theme)
    activeConfig.themeName = themeName
    await window.api.saveConfig({ themeName })
  }
})

selBgType.addEventListener('change', async () => {
  activeConfig.background.type = selBgType.value as any
  applyBackground()
  updateSettingsForm()
  await window.api.saveConfig({ background: activeConfig.background })
})

selBgFit.addEventListener('change', async () => {
  activeConfig.background.fit = selBgFit.value as any
  applyBackground()
  await window.api.saveConfig({ background: activeConfig.background })
})

// BUG-20: Debounce config saves (avoid writing to disk on every slider input)
let saveConfigTimeout: NodeJS.Timeout | null = null
function debouncedSaveConfig(updates: any, delay = 500) {
  if (saveConfigTimeout) clearTimeout(saveConfigTimeout)
  saveConfigTimeout = setTimeout(() => {
    window.api.saveConfig(updates)
  }, delay)
}

sliderDim.addEventListener('input', () => {
  const val = Number(sliderDim.value) / 100
  labelDim.textContent = `${sliderDim.value}%`
  activeConfig.background.dim = val
  applyBackground()
  debouncedSaveConfig({ background: activeConfig.background })
})

sliderMediaOpacity.addEventListener('input', () => {
  const val = Number(sliderMediaOpacity.value) / 100
  labelMediaOpacity.textContent = `${sliderMediaOpacity.value}%`
  activeConfig.background.opacity = val
  applyBackground()
  debouncedSaveConfig({ background: activeConfig.background })
})

sliderWinOpacity.addEventListener('input', () => {
  const val = Number(sliderWinOpacity.value) / 100
  labelWinOpacity.textContent = `${sliderWinOpacity.value}%`
  activeConfig.windowOpacity = val
  applyBackground()
  debouncedSaveConfig({ windowOpacity: val })
})

sliderBlur.addEventListener('input', async () => {
  const val = Number(sliderBlur.value)
  labelBlur.textContent = `${val}px`
  activeConfig.background.blur = val
  applyBackground()
  await window.api.saveConfig({ background: activeConfig.background })
})

chkAutoPause.addEventListener('change', async () => {
  activeConfig.autoPauseVideo = chkAutoPause.checked
  await window.api.saveConfig({ autoPauseVideo: activeConfig.autoPauseVideo })
})

chkPetToggle.addEventListener('change', () => {
  pet.setEnabled(chkPetToggle.checked)
  settingPetScaleContainer.style.display = chkPetToggle.checked ? 'flex' : 'none'
})

sliderPetScale.addEventListener('input', () => {
  const val = Number(sliderPetScale.value) / 100
  labelPetScale.textContent = `${sliderPetScale.value}%`
  pet.setScale(val)
})

;(window as any).onPetScaleChange = (newScale: number) => {
  sliderPetScale.value = Math.round(newScale * 100).toString()
  labelPetScale.textContent = `${sliderPetScale.value}%`
}

btnFontDec.addEventListener('click', () => setFontSize(activeConfig.terminal.fontSize - 1))
btnFontInc.addEventListener('click', () => setFontSize(activeConfig.terminal.fontSize + 1))
btnFontReset.addEventListener('click', () => setFontSize(14))

// Agent color pickers
function applyAgentColors() {
  document.documentElement.style.setProperty('--color-tool-preparing', colorToolPreparing.value)
  document.documentElement.style.setProperty('--color-tool-success', colorToolSuccess.value)
  document.documentElement.style.setProperty('--color-agent-response', colorAgentResponse.value)
  document.documentElement.style.setProperty('--color-error', colorError.value)
}

function saveAgentColors() {
  localStorage.setItem('agent-colors', JSON.stringify({
    toolPreparing: colorToolPreparing.value,
    toolSuccess: colorToolSuccess.value,
    agentResponse: colorAgentResponse.value,
    error: colorError.value
  }))
}

function loadAgentColors() {
  const saved = localStorage.getItem('agent-colors')
  if (saved) {
    const colors = JSON.parse(saved)
    colorToolPreparing.value = colors.toolPreparing || '#9ccfd8'
    colorToolSuccess.value = colors.toolSuccess || '#a3be8c'
    colorAgentResponse.value = colors.agentResponse || '#e0def4'
    colorError.value = colors.error || '#eb6f92'
  }
  applyAgentColors()
}

colorToolPreparing.addEventListener('input', () => {
  applyAgentColors()
  saveAgentColors()
})

colorToolSuccess.addEventListener('input', () => {
  applyAgentColors()
  saveAgentColors()
})

colorAgentResponse.addEventListener('input', () => {
  applyAgentColors()
  saveAgentColors()
})

colorError.addEventListener('input', () => {
  applyAgentColors()
  saveAgentColors()
})

// Save settings button
btnSaveSettings.addEventListener('click', () => {
  saveAgentColors()
  
  // Save current model selection
  if (modelSelect.value) {
    localStorage.setItem('last-selected-model', modelSelect.value)
  }
  
  // Show notification
  saveNotification.style.display = 'block'
  setTimeout(() => {
    saveNotification.style.display = 'none'
  }, 2000)
})

// Model select: persist selection
modelSelect.addEventListener('change', () => {
  if (modelSelect.value) {
    localStorage.setItem('last-selected-model', modelSelect.value)
  }
})

btnChooseFile.addEventListener('click', async () => {
  const result = await window.api.selectMedia()
  if (!result.canceled && result.path) {
    activeConfig.background.path = result.path
    if (result.type) {
      activeConfig.background.type = result.type
    }
    applyBackground()
    updateSettingsForm()
    await window.api.saveConfig({ background: activeConfig.background })
  }
})

btnClearFile.addEventListener('click', async () => {
  activeConfig.background.path = ''
  applyBackground()
  updateSettingsForm()
  await window.api.saveConfig({ background: activeConfig.background })
})

function updateSelectedModelOption(modelName: string): void {
  if (!modelName || !modelSelect) return
  let found = false
  for (let i = 0; i < modelSelect.options.length; i++) {
    if (modelSelect.options[i].value === modelName) {
      modelSelect.selectedIndex = i
      found = true
      break
    }
  }
  if (!found) {
    const opt = document.createElement('option')
    opt.value = modelName
    opt.textContent = modelName.length > 25 ? modelName.slice(0, 23) + '…' : modelName
    opt.title = modelName
    modelSelect.appendChild(opt)
    modelSelect.value = modelName
  }
}

modelSelect.addEventListener('change', async () => {
  const chosen = modelSelect.value
  term.writeln(`\r\n\x1b[36m> /model ${chosen}\x1b[0m`)
  const res = await window.api.chatAgent(`/model ${chosen}`)
  if (res.response) {
    for (const line of res.response.split('\n')) {
      term.writeln(line)
    }
  }
})

// Chat Input Handlers
async function sendChatMessage() {
  const message = chatInput.value.trim()
  if (!message) return
  
  chatInput.value = ''

  if (message === '/clear') {
    term.clear()
    return
  }

  // Handle Slash Commands (e.g. /token, /model, /skills, /help)
  if (message.startsWith('/')) {
    term.writeln(`\r\n\x1b[36m> ${message}\x1b[0m`)
    try {
      const selectedModel = modelSelect.value
      const res = await window.api.chatAgent(message, selectedModel)
      if (res.error) {
        term.writeln(`\x1b[31m[Command Error]\x1b[0m ${res.error}`)
      } else if (res.response) {
        if (res.telemetry) {
          const boxWidth = Math.max(60, Math.min(term.cols - 2, 80))
          const topFill = Math.max(0, boxWidth - 18)
          const topBar = `\x1b[36m╭─ ☤ Vallenatrix ${'─'.repeat(topFill)}╮\x1b[0m`
          const botBar = `\x1b[36m╰${'─'.repeat(Math.max(0, boxWidth - 2))}╯\x1b[0m`
          term.writeln(`\r\n${topBar}`)
          
          const agentColor = colorAgentResponse.value
          const r = parseInt(agentColor.slice(1, 3), 16)
          const g = parseInt(agentColor.slice(3, 5), 16)
          const b = parseInt(agentColor.slice(5, 7), 16)
          const colorCode = `\x1b[38;2;${r};${g};${b}m`
          
          for (const line of res.response.split('\n')) {
            term.writeln(`${colorCode}${line}\x1b[0m`)
          }
          term.writeln(`${botBar}\r\n`)
          updateStatusBarMetrics(res.telemetry)
          updateStatus('Ready', 'done')
        } else {
          for (const line of res.response.split('\n')) {
            term.writeln(line)
          }
        }
      }
      if (res.updatedModel) {
        updateSelectedModelOption(res.updatedModel)
      }
      if (res.themeChange) {
        const newTheme = await window.api.getTheme(res.themeChange)
        if (newTheme) applyTheme(newTheme)
      }
      if (res.togglePty) {
        togglePtyMode(true)
      }
    } catch (err: any) {
      term.writeln(`\x1b[31m[Command Error]\x1b[0m ${err.message || 'Failed to execute command'}`)
    }
    chatInput.focus()
    return
  }

  const selectedModel = modelSelect.value
  
  // Display user message in terminal
  term.writeln(`\r\n\x1b[32m[You]\x1b[0m \x1b[37m${message}\x1b[0m`)
  updateStatus('Agent thinking...', 'thinking')

  try {
    const res = await window.api.chatAgent(message, selectedModel)
    if (res.error) {
      term.writeln(`\x1b[31m[Agent Error]\x1b[0m ${res.error}`)
      updateStatus('Ready', 'idle')
    } else if (res.response) {
      const boxWidth = Math.max(60, Math.min(term.cols - 2, 80))
      const topFill = Math.max(0, boxWidth - 18)
      const topBar = `\x1b[36m╭─ ☤ Vallenatrix ${'─'.repeat(topFill)}╮\x1b[0m`
      const botBar = `\x1b[36m╰${'─'.repeat(Math.max(0, boxWidth - 2))}╯\x1b[0m`
      term.writeln(`\r\n${topBar}`)
      
      // Use custom agent response color
      const agentColor = colorAgentResponse.value
      const r = parseInt(agentColor.slice(1, 3), 16)
      const g = parseInt(agentColor.slice(3, 5), 16)
      const b = parseInt(agentColor.slice(5, 7), 16)
      const colorCode = `\x1b[38;2;${r};${g};${b}m`
      
      for (const line of res.response.split('\n')) {
        term.writeln(`${colorCode}${line}\x1b[0m`)
      }
      term.writeln(`${botBar}\r\n`)
      if (res.telemetry) {
        updateStatusBarMetrics(res.telemetry)
      }
      updateStatus('Ready', 'done')
    }
  } catch (err: any) {
    term.writeln(`\x1b[31m[Agent Error]\x1b[0m ${err.message || 'Failed to chat with agent'}`)
    updateStatus('Ready', 'idle')
  }

  chatInput.focus()
}

function updateStatusBarMetrics(meta?: {
  totalTokens?: number
  contextWindow?: number
  latencySec?: number
  tokensPerSec?: number
}) {
  if (!meta) return
  const total = meta.totalTokens ?? 0
  const win = meta.contextWindow || 1_048_576
  const kTotal = total >= 1000 ? (total / 1000).toFixed(1) + 'K' : String(total)
  const kWin = win >= 1_000_000 ? (win / 1_000_000).toFixed(0) + 'M' : (win / 1000).toFixed(0) + 'K'
  const pct = Math.min(100, Math.max(0, Math.round((total / win) * 100)))

  // Visual Bar: [██░░░░░░░░]
  const filled = Math.min(10, Math.max(pct > 0 ? 1 : 0, Math.round(pct / 10)))
  const empty = 10 - filled
  const bar = `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`

  // Threshold colors: <50% green, 50-80% yellow, >80% orange, >95% red
  let color = '#4caf50'
  if (pct >= 95) color = '#f44336'
  else if (pct >= 80) color = '#ff9800'
  else if (pct >= 50) color = '#ffeb3b'

  if (statusContext) statusContext.textContent = `~${kTotal}/${kWin}`
  if (statusBarVisual) {
    statusBarVisual.textContent = `${bar} ~${pct}%`
    statusBarVisual.style.color = color
  }
  if (statusTelemetry && meta.latencySec !== undefined) {
    const lat = `${meta.latencySec.toFixed(1)}s`
    const vel = meta.tokensPerSec ? `${meta.tokensPerSec} t/s` : '0 t/s'
    statusTelemetry.textContent = `◷ ${lat} │ ↑ ${vel}`
  }
}

// Listen for live agent tool execution & thinking updates
window.api.onAgentStatus((status) => {
  if (status.type === 'thinking') {
    updateStatus(status.message, 'thinking')
  } else if (status.type === 'tool_start') {
    term.writeln(status.message)
    updateStatus('Agent running tool...', 'tool', status.message)
  } else if (status.type === 'tool_end') {
    for (const line of status.message.split('\n')) {
      term.writeln(line)
    }
    updateStatus('Tool completed', 'tool_end', status.message)
  } else if (status.type === 'review_complete') {
    term.writeln(`\x1b[36m${status.message}\x1b[0m`)
    updateStatus('Review completed', 'tool_end')
  }
})

btnSendChat.addEventListener('click', sendChatMessage)

// Slash Commands Autocomplete System
const slashAutocomplete = document.getElementById('slash-autocomplete') as HTMLDivElement
const SLASH_COMMANDS = [
  { cmd: '/model', desc: 'Ganti atau cek model AI (via 9router)' },
  { cmd: '/token', desc: 'Koneksikan token API 9router' },
  { cmd: '/plan', desc: 'Rencana implementasi markdown (.vallenatrix/plans/) tanpa eksekusi' },
  { cmd: '/plans', desc: 'Lihat daftar rencana implementasi tersimpan' },
  { cmd: '/tools', desc: 'Lihat daftar 12 toolset & tools' },
  { cmd: '/skills', desc: 'Lihat daftar 59 loaded skills' },
  { cmd: '/themes', desc: 'Lihat daftar tema warna UI' },
  { cmd: '/theme', desc: 'Ganti tema warna UI secara instan' },
  { cmd: '/stats', desc: 'Telemetry sesi, model & context' },
  { cmd: '/pty', desc: 'Beralih ke Direct Bash Shell (Ctrl+`)' },
  { cmd: '/memory', desc: 'Lihat catatan memori & profil user' },
  { cmd: '/todos', desc: 'Lihat daftar tugas (active task list)' },
  { cmd: '/sessions', desc: 'Daftar riwayat sesi chat tersimpan' },
  { cmd: '/resume', desc: 'Lanjutkan sesi chat sebelumnya' },
  { cmd: '/stop', desc: 'Hentikan paksa turn yang sedang jalan' },
  { cmd: '/new', desc: 'Mulai percakapan sesi baru' },
  { cmd: '/clear', desc: 'Bersihkan tampilan layar terminal' },
  { cmd: '/help', desc: 'Bantuan lengkap semua perintah' }
]

let activeSlashIndex = 0
let filteredSlashCommands = [...SLASH_COMMANDS]

function renderSlashAutocomplete(): void {
  if (!slashAutocomplete) return
  if (filteredSlashCommands.length === 0) {
    slashAutocomplete.classList.add('hidden')
    return
  }
  slashAutocomplete.innerHTML = ''
  filteredSlashCommands.forEach((item, idx) => {
    const div = document.createElement('div')
    div.className = `slash-item ${idx === activeSlashIndex ? 'active' : ''}`
    div.innerHTML = `<span class="slash-item-cmd">${item.cmd}</span><span class="slash-item-desc">${item.desc}</span>`
    div.addEventListener('mousedown', (e) => {
      e.preventDefault()
      applySlashCommand(item.cmd)
    })
    slashAutocomplete.appendChild(div)
  })
  slashAutocomplete.classList.remove('hidden')
}

function applySlashCommand(cmd: string): void {
  chatInput.value = `${cmd} `
  slashAutocomplete.classList.add('hidden')
  chatInput.focus()
}

chatInput.addEventListener('input', () => {
  const val = chatInput.value
  if (val.startsWith('/') && !val.includes(' ')) {
    const query = val.slice(1).toLowerCase()
    filteredSlashCommands = SLASH_COMMANDS.filter(s => s.cmd.slice(1).startsWith(query))
    activeSlashIndex = 0
    renderSlashAutocomplete()
  } else {
    slashAutocomplete?.classList.add('hidden')
  }
})

chatInput.addEventListener('keydown', (e) => {
  if (slashAutocomplete && !slashAutocomplete.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeSlashIndex = (activeSlashIndex + 1) % filteredSlashCommands.length
      renderSlashAutocomplete()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeSlashIndex = (activeSlashIndex - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
      renderSlashAutocomplete()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      if (filteredSlashCommands[activeSlashIndex]) {
        applySlashCommand(filteredSlashCommands[activeSlashIndex].cmd)
      }
      return
    }
    if (e.key === 'Escape') {
      slashAutocomplete.classList.add('hidden')
      return
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    slashAutocomplete?.classList.add('hidden')
    sendChatMessage()
  }
})

// Initialize Application
async function init(): Promise<void> {
  activeConfig = await window.api.getConfig()

  // Load theme list into dropdown
  const themes = await window.api.listThemes()
  selTheme.innerHTML = ''
  for (const t of themes) {
    const opt = document.createElement('option')
    opt.value = t.name
    opt.textContent = `${t.displayName}${t.isBuiltIn ? '' : ' (Custom)'}`
    selTheme.appendChild(opt)
  }

  // Load and apply theme
  let theme = await window.api.getTheme(activeConfig.themeName)
  if (!theme && themes.length > 0) {
    theme = await window.api.getTheme(themes[0].name)
  }
  if (theme) {
    applyTheme(theme)
  }

  // Configure terminal options from config
  term.options.fontFamily = activeConfig.terminal.fontFamily
  term.options.fontSize = activeConfig.terminal.fontSize
  term.options.fontWeight = '600'
  term.options.fontWeightBold = '700'
  term.options.lineHeight = activeConfig.terminal.lineHeight
  term.options.cursorBlink = activeConfig.terminal.cursorBlink
  term.options.cursorStyle = activeConfig.terminal.cursorStyle

  // Load agent colors
  loadAgentColors()

  // Restore last selected model
  const lastModel = localStorage.getItem('last-selected-model')
  if (lastModel && modelSelect) {
    // Wait a bit for model list to populate
    setTimeout(() => {
      for (let i = 0; i < modelSelect.options.length; i++) {
        if (modelSelect.options[i].value === lastModel) {
          modelSelect.selectedIndex = i
          break
        }
      }
    }, 500)
  }

  applyBackground()
  updateSettingsForm()

  const statusSymbolEl = document.querySelector('.status-symbol') as HTMLElement
  if (statusSymbolEl) {
    statusSymbolEl.style.cursor = 'pointer'
    statusSymbolEl.addEventListener('click', () => togglePtyMode())
  }

  fitAddon.fit()
  window.api.resizeTerminal(term.cols, term.rows)

  // Real startup loading sequence & health checks
  try {
    updateStatus('Booting Vallenatrix...', 'boot')
    const payload = await window.api.getBanner()

    term.clear()

    if (typeof payload === 'string') {
      for (const line of payload.split('\n')) {
        term.writeln(line)
      }
    } else if (payload) {
      if (payload.model) updateSelectedModelOption(payload.model)

      // 1. Render ASCII banner
      if (payload.asciiBanner) {
        for (const line of payload.asciiBanner.split('\n')) {
          term.writeln(line)
        }
        term.writeln('')
      }

      // 2. Stream health checks with step progression
      if (payload.diagHeader && Array.isArray(payload.healthChecks)) {
        term.writeln(payload.diagHeader)

        for (const item of payload.healthChecks) {
          updateStatus(`Verifying ${item.title}...`, 'tool', item.title)
          term.writeln(item.formattedRow)
          await new Promise((r) => setTimeout(r, 60))
        }

        term.writeln(payload.diagFooter)
        term.writeln('')
      }

      // 3. Render Quick Commands guide box
      if (Array.isArray(payload.guideBox)) {
        for (const line of payload.guideBox) {
          term.writeln(line)
        }
        term.writeln('')
      }
    }

    updateStatus('Ready', 'idle')
    chatInput.focus()
  } catch (err) {
    console.error('Failed to load startup banner & diagnostics:', err)
    updateStatus('Ready', 'idle')
    chatInput.focus()
  }
}

init().catch(console.error)
