import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { VallenApi } from '../preload/index'
import { sanitizeConfig, validateTheme } from '../shared/types'
import type { AppConfig, Theme } from '../shared/types'
import { buildPromptForAgent, normalizePrompt, shouldOffloadPaste } from '../shared/prompt-input'
import type { SavedPasteReference } from '../shared/prompt-input'
import { TerminalPet } from './pet'
import { renderMarkdownForTerminal } from './format'

declare global {
  interface Window {
    api: VallenApi
  }
}

let activeConfig: AppConfig
let startupBannerText = ''

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
const btnNewTerminal = document.getElementById('btn-new-terminal') as HTMLButtonElement
const terminalTabsEl = document.getElementById('terminal-tabs') as HTMLDivElement

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
const selPetKind = document.getElementById('setting-pet-kind') as HTMLSelectElement
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
const btnExportSettings = document.getElementById('btn-export-settings') as HTMLButtonElement
const btnImportSettings = document.getElementById('btn-import-settings') as HTMLButtonElement
const importSettingsFile = document.getElementById('setting-import-file') as HTMLInputElement

// Agent color pickers
const colorToolPreparing = document.getElementById('setting-color-tool-preparing') as HTMLInputElement
const colorToolSuccess = document.getElementById('setting-color-tool-success') as HTMLInputElement
const colorAgentResponse = document.getElementById('setting-color-agent-response') as HTMLInputElement
const colorError = document.getElementById('setting-color-error') as HTMLInputElement

// Chat input elements
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement
const btnSendChat = document.getElementById('btn-send-chat') as HTMLButtonElement
const chatAttachmentsEl = document.getElementById('chat-attachments') as HTMLDivElement
const dragDropOverlay = document.getElementById('drag-drop-overlay') as HTMLDivElement
const modelSelect = document.getElementById('model-select') as HTMLSelectElement
const btnDeleteModel = document.getElementById('btn-delete-model') as HTMLButtonElement
const btnRestoreModels = document.getElementById('btn-restore-models') as HTMLButtonElement
const defaultModelOptions = Array.from(modelSelect.options).map((option) => ({ value: option.value, label: option.textContent || option.value, title: option.title }))
const MODEL_REMOVED_KEY = 'removed-models'
const MODEL_CUSTOM_KEY = 'custom-models'
function readModelList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
const removedModels = new Set(readModelList(MODEL_REMOVED_KEY))
const customModels = new Set(readModelList(MODEL_CUSTOM_KEY))
for (const option of Array.from(modelSelect.options)) {
  if (removedModels.has(option.value)) option.remove()
}
for (const model of customModels) {
  if (removedModels.has(model) || Array.from(modelSelect.options).some((option) => option.value === model)) continue
  const option = document.createElement('option')
  option.value = model
  option.textContent = model.length > 25 ? `${model.slice(0, 23)}…` : model
  option.title = model
  modelSelect.append(option)
}
const statusProgress = document.getElementById('status-progress') as HTMLSpanElement
const statusContext = document.getElementById('status-context') as HTMLSpanElement
const statusBarVisual = document.getElementById('status-bar-visual') as HTMLSpanElement
const statusTelemetry = document.getElementById('status-telemetry') as HTMLSpanElement
const agentTerminalPanel = document.getElementById('agent-terminal-panel') as HTMLDivElement
const agentTerminalCommand = document.getElementById('agent-terminal-command') as HTMLSpanElement
const agentTerminalOutput = document.getElementById('agent-terminal-output') as HTMLPreElement
const agentTerminalNotice = document.getElementById('agent-terminal-notice') as HTMLDivElement
const agentTerminalNoticeText = document.getElementById('agent-terminal-notice-text') as HTMLSpanElement
const agentTerminalShow = document.getElementById('agent-terminal-show') as HTMLButtonElement
const agentTerminalNoticeStop = document.getElementById('agent-terminal-notice-stop') as HTMLButtonElement
const agentTerminalBack = document.getElementById('agent-terminal-back') as HTMLButtonElement
const agentTerminalStop = document.getElementById('agent-terminal-stop') as HTMLButtonElement
const agentTerminalNew = document.getElementById('agent-terminal-new') as HTMLButtonElement
let agentRequestActive = false
let activeTerminalId = ''
const terminalOutputById = new Map<string, string>()
const initializedTerminalModels = new Set<string>()
const agentOutputById = new Map<string, string>()
const displayedSessionLabels = new Set<string>()
const runningAgentIds = new Set<string>()
const agentTerminalOutputById = new Map<string, string>()
const agentTerminalCommandById = new Map<string, string>()
let backgroundNoticeTerminalId = ''
let openTerminalPanelOnSwitch = false
let terminalChordArmedUntil = 0
interface ChatAttachment {
  name: string
  path: string
  type: string
  size: number
  isImage: boolean
}

const chatAttachments: ChatAttachment[] = []
interface PendingPaste extends SavedPasteReference { placeholder: string }
const pendingPastes: PendingPaste[] = []
const pendingPasteSaves = new Set<string>()
const MAX_CHAT_ATTACHMENTS = 10
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024

function renderChatAttachments(): void {
  chatAttachmentsEl.replaceChildren()
  chatAttachments.forEach((file, index) => {
    const displayName = file.name.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 180) || 'file'
    const chip = document.createElement('span')
    chip.className = 'chat-attachment'
    const name = document.createElement('span')
    name.className = 'chat-attachment-name'
    name.textContent = `${file.isImage ? '🖼' : '📎'} ${displayName}`
    const remove = document.createElement('button')
    remove.className = 'chat-attachment-remove'
    remove.type = 'button'
    remove.title = `Hapus ${displayName}`
    remove.setAttribute('aria-label', remove.title)
    remove.textContent = '×'
    remove.addEventListener('click', () => {
      chatAttachments.splice(index, 1)
      renderChatAttachments()
      chatInput.focus()
    })
    chip.append(name, remove)
    chatAttachmentsEl.appendChild(chip)
  })
}

function addDroppedFiles(files: FileList | File[]): void {
  for (const file of Array.from(files)) {
    const displayName = file.name.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 180) || 'file'
    const filePath = (file as File & { path?: string }).path
    if (!filePath) {
      term.writeln(`\x1b[31m[File Error]\x1b[0m Tidak bisa membaca lokasi file: ${displayName}`)
      continue
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      term.writeln(`\x1b[31m[File Error]\x1b[0m ${displayName} lebih besar dari 20 MB.`)
      continue
    }
    if (chatAttachments.some(attached => attached.path === filePath)) continue
    if (chatAttachments.length >= MAX_CHAT_ATTACHMENTS) {
      term.writeln(`\x1b[33m[Maksimum ${MAX_CHAT_ATTACHMENTS} file per pesan]\x1b[0m`)
      break
    }
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    const isImage = file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extension)
    chatAttachments.push({ name: file.name, path: filePath, type: file.type, size: file.size, isImage })
  }
  renderChatAttachments()
  if (chatAttachments.length) {
    chatInput.focus()
    updateStatus(`${chatAttachments.length} file terlampir`, 'idle')
  }
}

let fileDragDepth = 0
window.addEventListener('dragenter', event => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return
  event.preventDefault()
  fileDragDepth++
  dragDropOverlay.classList.add('visible')
})
window.addEventListener('dragover', event => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
})
window.addEventListener('dragleave', event => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return
  fileDragDepth = Math.max(0, fileDragDepth - 1)
  if (!fileDragDepth) dragDropOverlay.classList.remove('visible')
})
window.addEventListener('drop', event => {
  const files = event.dataTransfer?.files
  if (!files?.length) return
  event.preventDefault()
  fileDragDepth = 0
  dragDropOverlay.classList.remove('visible')
  addDroppedFiles(files)
})

function setAgentRequestActive(active: boolean, terminalId = activeTerminalId): void {
  if (active) runningAgentIds.add(terminalId)
  else runningAgentIds.delete(terminalId)
  terminalTabsEl.querySelector(`[data-terminal-id="${terminalId}"]`)?.classList.toggle('running', runningAgentIds.has(terminalId))
  if (terminalId !== activeTerminalId) return
  agentRequestActive = active
  btnSendChat.title = active ? 'Hentikan agent' : 'Kirim (Enter)'
  btnSendChat.setAttribute('aria-label', btnSendChat.title)
  btnSendChat.classList.toggle('is-cancel', active)
  btnSendChat.innerHTML = active
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>'
}
setAgentRequestActive(false)

function appendAgentOutput(terminalId: string, text: string): void {
  const current = agentOutputById.get(terminalId) || ''
  agentOutputById.set(terminalId, (current + text).slice(-200_000))
  if (terminalId === activeTerminalId) term.write(text)
}

function updateStartupSessionRow(label: string): void {
  const buffer = term.buffer.active
  const firstVisibleLine = buffer.baseY
  const lastVisibleLine = Math.min(buffer.length - 1, buffer.baseY + term.rows - 1)
  let creatorLine = -1
  for (let line = firstVisibleLine; line <= lastVisibleLine; line++) {
    if (buffer.getLine(line)?.translateToString(true).includes('Created by @vallenganteng')) {
      creatorLine = line
      break
    }
  }
  const screenRow = creatorLine + 1 - buffer.baseY
  if (!label || creatorLine < 0 || screenRow < 1 || screenRow > term.rows) return
  const text = label.slice(0, 63)
  const row = `\\x1b[36m│\\x1b[0m  ${text}${' '.repeat(Math.max(0, 63 - text.length))}\\x1b[36m│\\x1b[0m`
  term.write(`\\x1b[s\\x1b[${screenRow};1H\\x1b[2K${row}\\x1b[u`)
}

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
term.writeln('\x1b[36mMemuat Vallenatrix…\x1b[0m')
window.api.onTerminalExit(({ terminalId, code }) => {
  if (terminalId !== activeTerminalId) return
  togglePtyMode(false)
  term.writeln(`\r\nShell berakhir (kode ${code}). Ketik /pty untuk membuka shell baru.`)
})

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

function togglePtyMode(force?: boolean, startShell = true, pressEnter = true): void {
  const wasDirectPtyMode = isDirectPtyMode
  isDirectPtyMode = force !== undefined ? force : !isDirectPtyMode
  if (isDirectPtyMode && !wasDirectPtyMode && startShell) window.api.startPty()
  const statusSymbol = document.querySelector('.status-symbol') as HTMLElement

  if (isDirectPtyMode) {
    if (statusSymbol) {
      statusSymbol.textContent = '💻'
      statusSymbol.title = 'Direct PTY Shell Active (Ctrl+` to switch back to AI)'
    }
    updateStatus('PTY Shell Active', 'pty')
    term.focus()
    if (!hasEnteredPty && pressEnter) {
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

window.api.onTerminalData(({ terminalId, data }) => {
  const previous = terminalOutputById.get(terminalId) || ''
  terminalOutputById.set(terminalId, (previous + data).slice(-200_000))
  if (terminalId === activeTerminalId) term.write(data)
})

window.api.onTerminalSwitched(({ terminalId, output, model }) => {
  activeTerminalId = terminalId
  const visibleOutput = startupBannerText + output
  terminalOutputById.set(terminalId, visibleOutput)
  term.clear()
  if (visibleOutput) term.write(visibleOutput)
  const agentOutput = agentOutputById.get(terminalId)
  if (agentOutput) term.write(agentOutput)
  agentTerminalCommand.textContent = agentTerminalCommandById.get(terminalId) || ''
  agentTerminalOutput.textContent = agentTerminalOutputById.get(terminalId) || ''
  if (agentTerminalOutput.textContent) agentTerminalNotice.classList.remove('hidden')
  hasEnteredPty = true
  togglePtyMode(false, false, false)
  setAgentRequestActive(runningAgentIds.has(terminalId), terminalId)
  if (openTerminalPanelOnSwitch || backgroundNoticeTerminalId === terminalId) {
    openTerminalPanelOnSwitch = false
    showAgentTerminalPanel()
  }
  const lastModel = localStorage.getItem('last-selected-model')
  const inheritLastModel = !initializedTerminalModels.has(terminalId) && !!lastModel && !removedModels.has(lastModel)
  const selectedModel = inheritLastModel ? lastModel! : model
  initializedTerminalModels.add(terminalId)
  updateSelectedModelOption(selectedModel)
  if (inheritLastModel && selectedModel !== model) {
    void window.api.chatAgent(`/model ${selectedModel}`, undefined, terminalId)
  }
})

if (new URLSearchParams(window.location.search).get('mode') === 'terminal') {
  togglePtyMode(true)
}

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
btnNewTerminal.addEventListener('click', () => window.api.newTerminal())

const commandPalette = document.getElementById('command-palette') as HTMLDivElement
const commandPaletteSearch = document.getElementById('command-palette-search') as HTMLInputElement
const commandPaletteList = document.getElementById('command-palette-list') as HTMLDivElement
const PALETTE_COMMANDS = [
  { command: '/help', description: 'Show command help' },
  { command: '/sessions', description: 'List saved sessions' },
  { command: '/resume', description: 'Resume a saved session' },
  { command: '/theme', description: 'Change terminal theme' },
  { command: '/settings', description: 'Open settings' },
  { command: '/health', description: 'Show runtime health' },
  { command: '/auto', description: 'Auto-approve safe tools' },
  { command: '/perf', description: 'Measure app CPU and memory' },
  { command: '/new', description: 'Start a new conversation' }
]
let filteredPaletteCommands = [...PALETTE_COMMANDS]
let activePaletteIndex = 0
let paletteOpener: HTMLElement | null = null

function renderCommandPalette(): void {
  commandPaletteList.replaceChildren()
  if (!filteredPaletteCommands.length) {
    const empty = document.createElement('div')
    empty.className = 'command-palette-empty'
    empty.textContent = 'No matching commands'
    commandPaletteList.append(empty)
    return
  }
  filteredPaletteCommands.forEach((item, index) => {
    const option = document.createElement('button')
    option.type = 'button'
    option.className = `command-palette-item${index === activePaletteIndex ? ' active' : ''}`
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', String(index === activePaletteIndex))
    const command = document.createElement('span')
    command.className = 'command-palette-command'
    command.textContent = item.command
    const description = document.createElement('span')
    description.className = 'command-palette-description'
    description.textContent = item.description
    option.append(command, description)
    option.addEventListener('click', () => runPaletteCommand(item.command))
    commandPaletteList.append(option)
  })
}

function openCommandPalette(opener: HTMLElement): void {
  paletteOpener = opener
  commandPaletteSearch.value = ''
  filteredPaletteCommands = [...PALETTE_COMMANDS]
  activePaletteIndex = 0
  renderCommandPalette()
  commandPalette.classList.remove('hidden')
  commandPaletteSearch.focus()
}

function closeCommandPalette(): void {
  commandPalette.classList.add('hidden')
  paletteOpener?.focus()
  paletteOpener = null
}

function runPaletteCommand(command: string): void {
  closeCommandPalette()
  if (command === '/settings') {
    toggleSettings()
    return
  }
  chatInput.value = command
  resizeChatInput()
  void sendChatMessage()
}

commandPaletteSearch.addEventListener('input', () => {
  const query = commandPaletteSearch.value.trim().toLowerCase()
  filteredPaletteCommands = PALETTE_COMMANDS.filter((item) => `${item.command} ${item.description}`.toLowerCase().includes(query))
  activePaletteIndex = 0
  renderCommandPalette()
})
commandPaletteSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeCommandPalette()
  } else if (e.key === 'ArrowDown' && filteredPaletteCommands.length) {
    e.preventDefault()
    activePaletteIndex = (activePaletteIndex + 1) % filteredPaletteCommands.length
    renderCommandPalette()
  } else if (e.key === 'ArrowUp' && filteredPaletteCommands.length) {
    e.preventDefault()
    activePaletteIndex = (activePaletteIndex - 1 + filteredPaletteCommands.length) % filteredPaletteCommands.length
    renderCommandPalette()
  } else if (e.key === 'Enter' && filteredPaletteCommands[activePaletteIndex]) {
    e.preventDefault()
    runPaletteCommand(filteredPaletteCommands[activePaletteIndex].command)
  }
})
commandPalette.addEventListener('mousedown', (e) => {
  if (e.target === commandPalette) closeCommandPalette()
})

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    e.stopPropagation()
    openCommandPalette(e.target as HTMLElement)
    return
  }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'm') {
    e.preventDefault()
    e.stopPropagation()
    window.api.newTerminal()
    return
  }

  if (terminalChordArmedUntil > Date.now()) {
    const key = e.key.toLowerCase()
    if (['c', 'b'].includes(key)) {
      e.preventDefault()
      e.stopPropagation()
      terminalChordArmedUntil = 0
      if (key === 'c') stopAgentTurn()
      else hideAgentTerminalPanel()
      return
    }
  }

  // Ctrl+Shift+R: Refresh UI
  if (e.ctrlKey && e.shiftKey && e.key === 'R') {
    e.preventDefault()
    window.location.reload()
    return
  }

  // Ctrl+` toggles direct PTY; Ctrl+T opens the live agent terminal monitor.
  if (!isDirectPtyMode && e.ctrlKey && e.key === 't') {
    e.preventDefault()
    showAgentTerminalPanel()
    terminalChordArmedUntil = Date.now() + 1800
    return
  }
  if (!isDirectPtyMode && e.ctrlKey && e.key === '`') {
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
  const isPaletteInput = target === commandPaletteSearch
  const isSettingsInput = settingsPanel.contains(target) && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
  if (isPaletteInput) return
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
  return `vallen-media://local${filePath.split('/').map(encodeURIComponent).join('/')}`
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
  } else {
    videoEl.removeAttribute('src')
    imageEl.style.backgroundImage = ''
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
  debouncedSaveConfig({ terminal: activeConfig.terminal })
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
    await saveConfigSafely({ themeName })
  }
})

selBgType.addEventListener('change', async () => {
  activeConfig.background.type = selBgType.value as any
  applyBackground()
  updateSettingsForm()
  await saveConfigSafely({ background: activeConfig.background })
})

selBgFit.addEventListener('change', async () => {
  activeConfig.background.fit = selBgFit.value as any
  applyBackground()
  await saveConfigSafely({ background: activeConfig.background })
})

async function saveConfigSafely(config: Parameters<typeof window.api.saveConfig>[0]): Promise<void> {
  try {
    await window.api.saveConfig(config)
  } catch {
    saveNotification.textContent = 'Failed to save settings'
    saveNotification.style.display = 'block'
    setTimeout(() => { saveNotification.style.display = 'none' }, 2500)
  }
}

// Merge pending updates so independent setting changes survive debounce.
let saveConfigTimeout: NodeJS.Timeout | null = null
let pendingConfigUpdates: Record<string, any> = {}
const pendingApprovals = new Map<string, { approvalId: string }[]>()
function debouncedSaveConfig(updates: any, delay = 500) {
  pendingConfigUpdates = { ...pendingConfigUpdates, ...updates,
    ...(updates.background && pendingConfigUpdates.background ? { background: { ...pendingConfigUpdates.background, ...updates.background } } : {}) }
  if (saveConfigTimeout) clearTimeout(saveConfigTimeout)
  saveConfigTimeout = setTimeout(() => {
    const pending = pendingConfigUpdates
    pendingConfigUpdates = {}
    saveConfigTimeout = null
    void saveConfigSafely(pending)
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
  debouncedSaveConfig({ background: activeConfig.background })
})

chkAutoPause.addEventListener('change', async () => {
  activeConfig.autoPauseVideo = chkAutoPause.checked
  await saveConfigSafely({ autoPauseVideo: activeConfig.autoPauseVideo })
})

chkPetToggle.addEventListener('change', () => {
  pet.setEnabled(chkPetToggle.checked)
  settingPetScaleContainer.style.display = chkPetToggle.checked ? 'flex' : 'none'
})

selPetKind.value = pet.getKind()
selPetKind.addEventListener('change', () => pet.setKind(selPetKind.value as 'cat' | 'fox' | 'slime' | 'robot'))

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
    let colors: Record<string, string> = {}
    try { colors = JSON.parse(saved) } catch { localStorage.removeItem('agent-colors') }
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
const safeConfigForTransfer = (config: AppConfig) => ({
  themeName: config.themeName,
  windowOpacity: config.windowOpacity,
  autoPauseVideo: config.autoPauseVideo,
  background: { type: config.background.type, dim: config.background.dim, fit: config.background.fit, blur: config.background.blur, opacity: config.background.opacity },
  terminal: { ...config.terminal },
  ...(config.agentApproval ? { agentApproval: config.agentApproval } : {})
})

btnExportSettings.addEventListener('click', async () => {
  const themeList = await window.api.listThemes()
  const themes = (await Promise.all(themeList.filter((theme) => !theme.isBuiltIn).map((theme) => window.api.getTheme(theme.name))))
    .filter((theme): theme is Theme => theme !== null)
  const payload = { format: 'vallenatrix-settings', version: 1, config: safeConfigForTransfer(activeConfig), themes }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'vallenatrix-settings.json'
  link.click()
  URL.revokeObjectURL(url)
})

btnImportSettings.addEventListener('click', () => importSettingsFile.click())
importSettingsFile.addEventListener('change', async () => {
  const file = importSettingsFile.files?.[0]
  importSettingsFile.value = ''
  if (!file) return
  try {
    const raw: unknown = JSON.parse(await file.text())
    if (!raw || typeof raw !== 'object') throw new Error('Invalid settings file')
    const data = raw as Record<string, unknown>
    if (data.format !== 'vallenatrix-settings' || data.version !== 1 || !data.config || typeof data.config !== 'object' || !Array.isArray(data.themes)) throw new Error('Invalid settings file')
    const imported = data.config as Record<string, unknown>
    const safeKeys = ['themeName', 'windowOpacity', 'autoPauseVideo', 'background', 'terminal', 'agentApproval']
    if (Object.keys(data).some((key) => !['format', 'version', 'config', 'themes'].includes(key)) || Object.keys(imported).some((key) => !safeKeys.includes(key))) throw new Error('Settings file contains unsupported fields')
    if (typeof imported.themeName !== 'string' || typeof imported.windowOpacity !== 'number' || imported.windowOpacity < 0.1 || imported.windowOpacity > 1 || typeof imported.autoPauseVideo !== 'boolean' || !imported.background || typeof imported.background !== 'object' || !imported.terminal || typeof imported.terminal !== 'object') throw new Error('Invalid settings config')
    const background = imported.background as Record<string, unknown>
    const terminal = imported.terminal as Record<string, unknown>
    if (Object.keys(background).some((key) => !['type', 'dim', 'fit', 'blur', 'opacity'].includes(key)) || Object.keys(terminal).some((key) => !['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'cursorStyle', 'cursorBlink', 'scrollback'].includes(key))) throw new Error('Settings file contains unsupported fields')
    const config = sanitizeConfig({ ...activeConfig, ...imported, background: { ...activeConfig.background, ...background }, shell: activeConfig.shell })
    const themes = data.themes.map((rawTheme) => {
      if (!rawTheme || typeof rawTheme !== 'object' || Object.keys(rawTheme).some((key) => !['name', 'displayName', 'colors', 'backgroundPreset'].includes(key))) return null
      return validateTheme(rawTheme)
    })
    const themeColorsAreSafe = data.themes.every((rawTheme) => {
      if (!rawTheme || typeof rawTheme !== 'object') return false
      const theme = rawTheme as Record<string, unknown>
      if (!theme.colors || typeof theme.colors !== 'object' || Object.keys(theme.colors).some((key) => !['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite', 'foreground', 'background', 'cursor', 'cursorAccent', 'selectionBackground'].includes(key))) return false
      return !theme.backgroundPreset || (typeof theme.backgroundPreset === 'object' && Object.keys(theme.backgroundPreset).every((key) => ['type', 'dim', 'fit', 'blur', 'opacity'].includes(key)))
    })
    if (!themeColorsAreSafe) throw new Error('Theme contains unsupported fields')
    if (typeof imported.agentApproval !== 'undefined' && !['dangerous', 'all', 'off'].includes(imported.agentApproval as string)) throw new Error('Invalid agent approval setting')
    if (!['none', 'color', 'image', 'video'].includes(background.type as string) || !['cover', 'contain', 'fill', 'none'].includes(background.fit as string) || !['block', 'underline', 'bar'].includes(terminal.cursorStyle as string)) throw new Error('Invalid settings config')
    if (typeof background.dim !== 'number' || background.dim < 0 || background.dim > 1 || typeof background.opacity !== 'number' || background.opacity < 0 || background.opacity > 1 || typeof background.blur !== 'number' || background.blur < 0 || background.blur > 50 || typeof terminal.fontFamily !== 'string' || typeof terminal.fontSize !== 'number' || terminal.fontSize < 8 || terminal.fontSize > 48 || typeof terminal.lineHeight !== 'number' || terminal.lineHeight < 0.8 || terminal.lineHeight > 3 || typeof terminal.letterSpacing !== 'number' || terminal.letterSpacing < -2 || terminal.letterSpacing > 10 || typeof terminal.cursorBlink !== 'boolean' || typeof terminal.scrollback !== 'number' || terminal.scrollback < 100 || terminal.scrollback > 100000) throw new Error('Invalid settings config')
    if (themes.some((theme) => theme === null)) throw new Error('Invalid theme in settings file')
    const validatedThemes = themes as Theme[]
    for (const theme of validatedThemes) {
      if (!await window.api.saveTheme(theme)) throw new Error(`Could not save theme: ${theme.name}`)
    }
    await window.api.saveConfig({ ...safeConfigForTransfer(config), background: { ...config.background, path: activeConfig.background.path } })
    activeConfig = { ...activeConfig, ...config, shell: activeConfig.shell }
    const themeList = await window.api.listThemes()
    selTheme.innerHTML = ''
    for (const theme of themeList) {
      const option = document.createElement('option')
      option.value = theme.name
      option.textContent = `${theme.displayName}${theme.isBuiltIn ? '' : ' (Custom)'}`
      selTheme.appendChild(option)
    }
    const theme = await window.api.getTheme(activeConfig.themeName)
    if (theme) applyTheme(theme)
    term.options.fontFamily = activeConfig.terminal.fontFamily
    term.options.fontSize = activeConfig.terminal.fontSize
    term.options.lineHeight = activeConfig.terminal.lineHeight
    term.options.cursorBlink = activeConfig.terminal.cursorBlink
    term.options.cursorStyle = activeConfig.terminal.cursorStyle
    applyBackground()
    updateSettingsForm()
    saveNotification.textContent = 'Settings imported'
  } catch (error) {
    saveNotification.textContent = error instanceof Error ? error.message : 'Could not import settings'
  }
  saveNotification.style.display = 'block'
  setTimeout(() => { saveNotification.style.display = 'none' }, 2500)
})

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
  if (result.error) {
    saveNotification.textContent = result.error
    saveNotification.style.display = 'block'
    setTimeout(() => { saveNotification.style.display = 'none' }, 2500)
  }
  if (!result.canceled && result.path) {
    activeConfig.background.path = result.path
    if (result.type) {
      activeConfig.background.type = result.type
    }
    applyBackground()
    updateSettingsForm()
    await saveConfigSafely({ background: activeConfig.background })
  }
})

btnClearFile.addEventListener('click', async () => {
  activeConfig.background.path = ''
  applyBackground()
  updateSettingsForm()
  await saveConfigSafely({ background: activeConfig.background })
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
    if (removedModels.has(modelName)) {
      const fallback = modelSelect.options[0]?.value
      if (fallback) {
        modelSelect.value = fallback
        if (activeTerminalId) void window.api.chatAgent(`/model ${fallback}`, undefined, activeTerminalId)
      }
      return
    }
    const opt = document.createElement('option')
    opt.value = modelName
    opt.textContent = modelName.length > 25 ? modelName.slice(0, 23) + '…' : modelName
    opt.title = modelName
    modelSelect.appendChild(opt)
    modelSelect.value = modelName
    customModels.add(modelName)
    localStorage.setItem(MODEL_CUSTOM_KEY, JSON.stringify([...customModels]))
  }
}

function updateModelListActions(): void {
  btnDeleteModel.disabled = modelSelect.options.length <= 1
  btnRestoreModels.hidden = removedModels.size === 0
}

btnDeleteModel.addEventListener('click', () => {
  if (modelSelect.options.length <= 1) return
  const selected = modelSelect.value
  if (!selected) return
  removedModels.add(selected)
  localStorage.setItem(MODEL_REMOVED_KEY, JSON.stringify([...removedModels]))
  modelSelect.selectedOptions[0]?.remove()
  const fallback = modelSelect.options[0]?.value
  if (fallback) {
    modelSelect.value = fallback
    localStorage.setItem('last-selected-model', fallback)
    modelSelect.dispatchEvent(new Event('change'))
    updateStatus(`Model ${selected} dihapus dari daftar.`, 'tool_end')
  }
  updateModelListActions()
})

btnRestoreModels.addEventListener('click', () => {
  removedModels.clear()
  localStorage.removeItem(MODEL_REMOVED_KEY)
  for (const item of defaultModelOptions) {
    if (Array.from(modelSelect.options).some((option) => option.value === item.value)) continue
    const option = document.createElement('option')
    option.value = item.value
    option.textContent = item.label
    option.title = item.title
    modelSelect.append(option)
  }
  for (const model of customModels) {
    if (Array.from(modelSelect.options).some((option) => option.value === model)) continue
    const option = document.createElement('option')
    option.value = model
    option.textContent = model.length > 25 ? `${model.slice(0, 23)}…` : model
    option.title = model
    modelSelect.append(option)
  }
  updateModelListActions()
})

updateModelListActions()

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
  if (agentRequestActive && pendingApprovals.size === 0) {
    await window.api.chatAgent('/stop', undefined, activeTerminalId)
    return
  }
  const message = normalizePrompt(chatInput.value)
  const requestTerminalId = activeTerminalId
  const filesToSend = [...chatAttachments]
  const pastesToSend = pendingPastes.filter((paste) => message.includes(paste.placeholder))
  const hasMessage = message.trim().length > 0
  if (!hasMessage && !filesToSend.length && !pastesToSend.length) return
  if ([...pendingPasteSaves].some((token) => message.includes(token))) {
    appendAgentOutput(requestTerminalId, '\x1b[33m[Paste sedang disimpan]\x1b[0m Tunggu sebentar sebelum mengirim.\r\n')
    return
  }

  if (message.startsWith('/') && (filesToSend.length || pastesToSend.length)) {
    appendAgentOutput(requestTerminalId, '\x1b[33m[Lampiran belum dikirim]\x1b[0m Kirim perintah slash secara terpisah dari file terlampir.\r\n')
    return
  }
  
  chatInput.value = ''
  resizeChatInput()
  for (const paste of pastesToSend) pendingPastes.splice(pendingPastes.indexOf(paste), 1)
  chatAttachments.splice(0, chatAttachments.length)
  renderChatAttachments()

  // Approval replies target this terminal's pending prompt.
  const approvalQueue = pendingApprovals.get(requestTerminalId)
  const approval = approvalQueue?.[0]
  if (approval) {
    const answer = message.trim().toLowerCase()
    const allowed = ['y', 'ya', 'yes'].includes(answer)
    const denied = ['n', 'no', 'tidak', 'batal'].includes(answer)
    if (!allowed && !denied) {
      appendAgentOutput(requestTerminalId, '\x1b[33mBalas y untuk izinkan atau n untuk tolak.\x1b[0m\r\n')
      chatInput.focus()
      return
    }
    appendAgentOutput(requestTerminalId, allowed
      ? '\x1b[32m> y (disetujui)\x1b[0m\r\n'
      : '\x1b[31m> n (ditolak)\x1b[0m\r\n')
    approvalQueue!.shift()
    if (!approvalQueue!.length) pendingApprovals.delete(requestTerminalId)
    void window.api.answerApproval(allowed, approval.approvalId)
    chatInput.focus()
    return
  }

  if (message === '/clear') {
    agentOutputById.delete(requestTerminalId)
    term.clear()
    return
  }

  // Handle Slash Commands (e.g. /token, /model, /skills, /help)
  if (message.startsWith('/')) {
    const safeCommandEcho = message
      .replace(/^(\/token)\s+\S+/i, '$1 ***')
      .replace(/^(\/geteway|\/gateway)\s+tel(?:egram)?\s+token\s+\S+/i, '$1 tel token ***')
    appendAgentOutput(requestTerminalId, `\r\n\x1b[36m> ${safeCommandEcho}\x1b[0m\r\n`)
    try {
      const selectedModel = modelSelect.value
      const res = await window.api.chatAgent(message, selectedModel, requestTerminalId)
      if (res.error) {
        appendAgentOutput(requestTerminalId, `\x1b[31m[Command Error]\x1b[0m ${res.error}\r\n`)
      } else if (res.response) {
        if (res.telemetry) {
          const boxWidth = Math.max(60, Math.min(term.cols - 2, 80))
          const topFill = Math.max(0, boxWidth - 18)
          const topBar = `\x1b[36m╭─ ☤ Vallenatrix ${'─'.repeat(topFill)}╮\x1b[0m`
          const botBar = `\x1b[36m╰${'─'.repeat(Math.max(0, boxWidth - 2))}╯\x1b[0m`
          appendAgentOutput(requestTerminalId, `\r\n${topBar}\r\n`)
          
          const agentColor = colorAgentResponse.value
          const r = parseInt(agentColor.slice(1, 3), 16)
          const g = parseInt(agentColor.slice(3, 5), 16)
          const b = parseInt(agentColor.slice(5, 7), 16)
          const colorCode = `\x1b[38;2;${r};${g};${b}m`

          for (const line of renderMarkdownForTerminal(res.response, colorCode, '\x1b[1;36m', '\x1b[36m')) {
            appendAgentOutput(requestTerminalId, `${line}\r\n`)
          }
          appendAgentOutput(requestTerminalId, `${botBar}\r\n`)
          updateStatusBarMetrics(res.telemetry)
          updateStatus('Ready', 'done')
        } else {
          for (const line of res.response.split('\n')) {
            appendAgentOutput(requestTerminalId, `${line}\r\n`)
          }
        }
      }
      if (res.updatedModel) {
        updateSelectedModelOption(res.updatedModel)
      }
      const setModelMatch = message.match(/^\/model\s+(.+)$/i)
      if (setModelMatch) {
        const modelName = setModelMatch[1].trim()
        updateSelectedModelOption(modelName)
        modelSelect.value = modelName
        localStorage.setItem('last-selected-model', modelName)
      }
      if (res.themeChange) {
        const newTheme = await window.api.getTheme(res.themeChange)
        if (newTheme) applyTheme(newTheme)
      }
      if (res.togglePty) {
        togglePtyMode(true)
      }
    } catch (err: any) {
      appendAgentOutput(requestTerminalId, `\x1b[31m[Command Error]\x1b[0m ${err.message || 'Failed to execute command'}\r\n`)
    }
    chatInput.focus()
    return
  }

  const selectedModel = modelSelect.value
  const imageFiles = filesToSend.filter(file => file.isImage)
  const attachmentPrompt = filesToSend.length
    ? `\n\nFile yang dilampirkan user (baca file teks dengan read_file; analisis foto/gambar dengan vision_analyze):\n${filesToSend.map(file => `- ${file.isImage ? 'Gambar' : 'File'} ${JSON.stringify(file.name)}: ${JSON.stringify(file.path)}`).join('\n')}`
    : ''
  const imageAnalysisInstruction = imageFiles.map(file =>
    `Call vision_analyze now with image_url=${JSON.stringify(file.path)} and question=${JSON.stringify(message || 'Jelaskan isi gambar ini dengan rinci dan jawab permintaan user.')}. Do not stop at the attachment notice.`
  ).join('\n')
  const prompt = `${buildPromptForAgent(hasMessage ? message : (imageFiles.length ? 'Tolong analisis foto yang aku lampirkan.' : 'Tolong periksa file yang aku lampirkan.'), pastesToSend)}${attachmentPrompt}${imageAnalysisInstruction ? `\n\nWajib analisis lampiran gambar sekarang:\n${imageAnalysisInstruction}` : ''}`
  
  // Display user message in terminal
  const displayedMessage = message || (imageFiles.length ? 'Tolong analisis foto yang aku lampirkan.' : 'Tolong periksa file yang aku lampirkan.')
  const attachmentSummary = filesToSend.length ? `\n  📎 ${filesToSend.map(file => file.name).join(', ')}` : ''
  appendAgentOutput(requestTerminalId, `\r\n\x1b[32m[You]\x1b[0m \x1b[37m${displayedMessage}${attachmentSummary}\x1b[0m\r\n`)
  updateStatus('Agent thinking...', 'thinking')
  setAgentRequestActive(true)

  try {
    const res = await window.api.chatAgent(prompt, selectedModel, requestTerminalId)
    if (res.error) {
      chatInput.value = message
      resizeChatInput()
      pendingPastes.unshift(...pastesToSend)
      chatAttachments.unshift(...filesToSend)
      renderChatAttachments()
      appendAgentOutput(requestTerminalId, `\x1b[31m[Agent Error]\x1b[0m ${res.error}\r\n`)
      updateStatus('Ready', 'idle')
    } else if (res.response) {
      if (res.sessionLabel && !displayedSessionLabels.has(requestTerminalId)) {
        displayedSessionLabels.add(requestTerminalId)
        if (requestTerminalId === activeTerminalId) updateStartupSessionRow(res.sessionLabel)
      }
      const boxWidth = Math.max(60, Math.min(term.cols - 2, 80))
      const topFill = Math.max(0, boxWidth - 18)
      const topBar = `\x1b[36m╭─ ☤ Vallenatrix ${'─'.repeat(topFill)}╮\x1b[0m`
      const botBar = `\x1b[36m╰${'─'.repeat(Math.max(0, boxWidth - 2))}╯\x1b[0m`
      appendAgentOutput(requestTerminalId, `\r\n${topBar}\r\n`)
      
      // Use custom agent response color
      const agentColor = colorAgentResponse.value
      const r = parseInt(agentColor.slice(1, 3), 16)
      const g = parseInt(agentColor.slice(3, 5), 16)
      const b = parseInt(agentColor.slice(5, 7), 16)
      const colorCode = `\x1b[38;2;${r};${g};${b}m`

      for (const line of renderMarkdownForTerminal(res.response, colorCode, '\x1b[1;36m', '\x1b[36m')) {
        appendAgentOutput(requestTerminalId, `${line}\r\n`)
      }
      appendAgentOutput(requestTerminalId, `${botBar}\r\n`)
      const interrupted = res.response.includes('[Interrupted by user]')
      if (res.telemetry) {
        updateStatusBarMetrics(res.telemetry)
        const state = interrupted ? 'Stopped' : 'Done'
        appendAgentOutput(requestTerminalId, `\x1b[90m${state}: ${res.telemetry.iterations ?? 0} iterations, ${res.telemetry.toolCalls ?? 0} tools, ${Number(res.telemetry.latencySec || 0).toFixed(1)}s\x1b[0m\r\n`)
      }
      updateStatus(interrupted ? 'Stopped' : 'Ready', interrupted ? 'idle' : 'done')
    }
  } catch (err: any) {
    chatInput.value = message
    resizeChatInput()
    pendingPastes.unshift(...pastesToSend)
    chatAttachments.unshift(...filesToSend)
    renderChatAttachments()
    appendAgentOutput(requestTerminalId, `\x1b[31m[Agent Error]\x1b[0m ${err.message || 'Failed to chat with agent'}\r\n`)
    updateStatus('Ready', 'idle')
  } finally {
    setAgentRequestActive(false, requestTerminalId)
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
function getTerminalLabel(terminalId: string): string {
  return terminalTabsEl.querySelector<HTMLElement>(`[data-terminal-id="${terminalId}"]`)?.dataset.terminalLabel || terminalId
}

window.api.onAgentStatus((status) => {
  const statusTerminalId = status.terminalId || activeTerminalId
  const isActive = statusTerminalId === activeTerminalId
  if (status.type === 'thinking' || status.type === 'tool_start' || status.type === 'terminal_start') {
    runningAgentIds.add(statusTerminalId)
    terminalTabsEl.querySelector(`[data-terminal-id="${statusTerminalId}"]`)?.classList.add('running')
  }

  if (status.type === 'thinking') {
    if (isActive) updateStatus(status.message, 'thinking')
    else {
      backgroundNoticeTerminalId = statusTerminalId
      agentTerminalNoticeText.textContent = `Agent ${getTerminalLabel(statusTerminalId)} sedang berjalan di background.`
      agentTerminalNotice.classList.remove('hidden')
    }
  } else if (status.type === 'tool_start') {
    appendAgentOutput(statusTerminalId, `${status.message}\r\n`)
    if (isActive) updateStatus('Agent running tool...', 'tool', status.message)
    else {
      backgroundNoticeTerminalId = statusTerminalId
      agentTerminalNoticeText.textContent = `Agent ${getTerminalLabel(statusTerminalId)} bekerja di background.`
      agentTerminalNotice.classList.remove('hidden')
    }
  } else if (status.type === 'tool_end') {
    for (const line of status.message.split('\n')) appendAgentOutput(statusTerminalId, `${line}\r\n`)
    if (isActive) updateStatus('Tool completed', 'tool_end', status.message)
  } else if (status.type === 'cancelled') {
    runningAgentIds.delete(statusTerminalId)
    terminalTabsEl.querySelector(`[data-terminal-id="${statusTerminalId}"]`)?.classList.remove('running')
    if (isActive) updateStatus(status.message, 'idle')
  } else if (status.type === 'terminal_start') {
    agentTerminalCommandById.set(statusTerminalId, status.command || 'perintah terminal')
    agentTerminalOutputById.set(statusTerminalId, '')
    backgroundNoticeTerminalId = statusTerminalId
    if (isActive) {
      agentTerminalCommand.textContent = status.command || 'perintah terminal'
      agentTerminalOutput.textContent = ''
    } else {
      agentTerminalNoticeText.textContent = `Agent ${getTerminalLabel(statusTerminalId)} menjalankan terminal di background.`
      agentTerminalNotice.classList.remove('hidden')
    }
    agentTerminalStop.disabled = false
    agentTerminalNoticeStop.disabled = false
  } else if (status.type === 'terminal_output') {
    if (status.id && status.chunk) {
      const cleanChunk = status.chunk.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      const previous = agentTerminalOutputById.get(statusTerminalId) || ''
      const next = (previous + cleanChunk).slice(-40000)
      agentTerminalOutputById.set(statusTerminalId, next)
      if (isActive) {
        agentTerminalOutput.textContent = next
        agentTerminalOutput.scrollTop = agentTerminalOutput.scrollHeight
      }
    }
  } else if (status.type === 'terminal_end') {
    let completionText = 'Perintah terminal agent selesai. Output bisa dilihat.'
    try {
      const result = JSON.parse(status.message || '')
      if (result.background && result.session_id) completionText = `Background process masih jalan · ID ${result.session_id} · process_manage: poll / wait / kill.`
    } catch {}
    if (isActive) {
      agentTerminalNoticeText.textContent = completionText
      agentTerminalStop.disabled = true
      agentTerminalNoticeStop.disabled = true
    } else {
      backgroundNoticeTerminalId = statusTerminalId
      agentTerminalNoticeText.textContent = `${getTerminalLabel(statusTerminalId)}: ${completionText}`
      agentTerminalNotice.classList.remove('hidden')
    }
  } else if (status.type === 'approval') {
    const queue = pendingApprovals.get(statusTerminalId) || []
    queue.push({ approvalId: status.approvalId || '' })
    pendingApprovals.set(statusTerminalId, queue)
    appendAgentOutput(statusTerminalId, `\x1b[33m${status.message}\x1b[0m\r\n`)
    appendAgentOutput(statusTerminalId, '\x1b[33mBalas \x1b[1my\x1b[0m\x1b[33m untuk izinkan atau \x1b[1mn\x1b[0m\x1b[33m untuk tolak.\x1b[0m\r\n')
    if (isActive) updateStatus('Waiting for approval...', 'thinking')
  } else if (status.type === 'review_complete') {
    // Background self-review runs after the answer; a notice landing after the
    // turn looks like an error, so keep it in the status bar unless it changed
    // something (the payload then carries the "updated" detail).
    if (isActive) {
      const changed = /updated/i.test(status.message || '')
      updateStatus(changed ? status.message : 'Self-review: no changes', changed ? 'tool_end' : 'idle')
    }
  }
})

function showAgentTerminalPanel(): void {
  agentTerminalPanel.classList.add('visible')
  agentTerminalOutput.scrollTop = agentTerminalOutput.scrollHeight
}

function hideAgentTerminalPanel(): void {
  agentTerminalPanel.classList.remove('visible')
  chatInput.focus()
}

function stopAgentTurn(terminalId = activeTerminalId): void {
  void window.api.chatAgent('/stop', undefined, terminalId).then((result) => {
    agentTerminalNoticeText.textContent = result.response || 'Permintaan stop dikirim.'
  }).catch(() => {
    agentTerminalNoticeText.textContent = 'Gagal menghentikan agent.'
  })
}

agentTerminalShow.addEventListener('click', () => {
  if (backgroundNoticeTerminalId && backgroundNoticeTerminalId !== activeTerminalId) {
    openTerminalPanelOnSwitch = true
    window.api.selectTerminal(backgroundNoticeTerminalId)
    return
  }
  showAgentTerminalPanel()
})
agentTerminalBack.addEventListener('click', hideAgentTerminalPanel)
agentTerminalStop.addEventListener('click', () => stopAgentTurn())
agentTerminalNoticeStop.addEventListener('click', () => stopAgentTurn(backgroundNoticeTerminalId || activeTerminalId))
agentTerminalNew.addEventListener('click', () => window.api.newTerminal())

btnSendChat.addEventListener('click', sendChatMessage)

function renderTerminalTabs(windows: Array<{ id: string; label: string }>, activeId: string): void {
  terminalTabsEl.replaceChildren()
  for (const item of windows) {
    const tab = document.createElement('div')
    tab.className = `terminal-tab${item.id === activeId ? ' active' : ''}${runningAgentIds.has(item.id) ? ' running' : ''}`
    tab.dataset.terminalId = item.id
    tab.dataset.terminalLabel = item.label
    const label = document.createElement('span')
    label.textContent = item.label
    tab.append(label)
    if (windows.length > 1) {
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'terminal-tab-close'
      close.textContent = '×'
      close.title = `Tutup ${item.label}`
      close.setAttribute('aria-label', `Tutup ${item.label}`)
      close.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        close.disabled = true
        close.textContent = '…'
        tab.remove()
        void window.api.closeTerminal(item.id).then((closed) => {
          if (!closed) {
            updateStatus('Tab terakhir tidak bisa ditutup.', 'tool_end')
            void window.api.getTerminals().then(({ windows, activeId }) => renderTerminalTabs(windows, activeId))
          }
        }).catch((error: unknown) => {
          updateStatus(`Gagal menutup tab: ${error instanceof Error ? error.message : String(error)}`, 'tool_end')
          void window.api.getTerminals().then(({ windows, activeId }) => renderTerminalTabs(windows, activeId))
        })
      })
      tab.append(close)
    }
    tab.title = `Pindah ke ${item.label}`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(item.id === activeId))
    tab.addEventListener('click', () => window.api.selectTerminal(item.id))
    terminalTabsEl.append(tab)
  }
}
window.api.onTerminals(({ windows, activeId }) => renderTerminalTabs(windows, activeId))
void window.api.getTerminals().then(({ windows, activeId, output, model }) => {
  renderTerminalTabs(windows, activeId)
  activeTerminalId = activeId
  terminalOutputById.set(activeId, startupBannerText + output)
  if (startupBannerText || output) {
    term.clear()
    term.write(startupBannerText + output)
  }
  const agentOutput = agentOutputById.get(activeId)
  if (agentOutput) term.write(agentOutput)
  setAgentRequestActive(runningAgentIds.has(activeId), activeId)
  const lastModel = localStorage.getItem('last-selected-model')
  const restoredModel = lastModel && !removedModels.has(lastModel) ? lastModel : model
  initializedTerminalModels.add(activeId)
  updateSelectedModelOption(restoredModel)
  if (restoredModel && restoredModel !== model) {
    void window.api.chatAgent(`/model ${restoredModel}`, undefined, activeId)
  }
})

// Slash Commands Autocomplete System
const slashAutocomplete = document.getElementById('slash-autocomplete') as HTMLDivElement
const SLASH_COMMANDS = [
  { cmd: '/geteway', desc: 'Pilih gateway WhatsApp atau Telegram' },
  { cmd: '/model', desc: 'Ganti atau cek model AI (via 9router)' },
  { cmd: '/token', desc: 'Koneksikan token API 9router' },
  { cmd: '/plan', desc: 'Rencana implementasi markdown (.vallenatrix/plans/) tanpa eksekusi' },
  { cmd: '/plans', desc: 'Lihat daftar rencana implementasi tersimpan' },
  { cmd: '/tools', desc: 'Lihat daftar toolset & tools' },
  { cmd: '/skills', desc: 'Lihat daftar skill yang tersedia' },
  { cmd: '/themes', desc: 'Lihat daftar tema warna UI' },
  { cmd: '/theme', desc: 'Ganti tema warna UI secara instan' },
  { cmd: '/stats', desc: 'Telemetry sesi, model & context' },
  { cmd: '/auto', desc: 'Auto-approve tool aman; tool berbahaya tetap minta izin' },
  { cmd: '/health', desc: 'Cek koneksi gateway, memori, platform' },
  { cmd: '/perf', desc: 'Ukur CPU/RSS proses aplikasi' },
  { cmd: '/pty', desc: 'Beralih ke Direct Bash Shell (Ctrl+`)' },
  { cmd: '/cd', desc: 'Ganti folder proyek untuk terminal dan agent tab ini' },
  { cmd: '/memory', desc: 'Lihat catatan memori & profil user' },
  { cmd: '/todos', desc: 'Lihat daftar tugas (active task list)' },
  { cmd: '/sessions', desc: 'Daftar riwayat sesi chat tersimpan' },
  { cmd: '/session', desc: 'Hapus seluruh riwayat sesi (perlu konfirmasi)' },
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

function resizeChatInput(): void {
  chatInput.style.height = 'auto'
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 180)}px`
}

function applySlashCommand(cmd: string): void {
  chatInput.value = `${cmd} `
  slashAutocomplete.classList.add('hidden')
  chatInput.focus()
}

chatInput.addEventListener('input', () => {
  resizeChatInput()
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

chatInput.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain') || ''
  if (!shouldOffloadPaste(text)) return
  event.preventDefault()

  const token = `[saving-paste:${crypto.randomUUID()}]`
  chatInput.setRangeText(token, chatInput.selectionStart, chatInput.selectionEnd, 'end')
  pendingPasteSaves.add(token)
  chatInput.dispatchEvent(new Event('input', { bubbles: true }))

  void window.api.savePastedText(text).then((saved) => {
    const start = chatInput.value.indexOf(token)
    if (start < 0) return
    const index = pendingPastes.length + 1
    const pasteFileName = saved.path.split('/.vallenatrix/pastes/').pop() || saved.path
    const pathLabel = `~/.vallenatrix/pastes/${pasteFileName}`
    const placeholder = `[pasted text #${index}: ${saved.lines} lines → ${pathLabel}]`
    chatInput.setRangeText(placeholder, start, start + token.length, 'end')
    pendingPastes.push({ ...saved, placeholder })
  }).catch(() => {
    const start = chatInput.value.indexOf(token)
    if (start >= 0) {
      chatInput.setRangeText(text, start, start + token.length, 'end')
      appendAgentOutput(activeTerminalId, '\x1b[33m[Paste save failed]\x1b[0m Text kept in input.\r\n')
    }
  }).finally(() => {
    pendingPasteSaves.delete(token)
    chatInput.dispatchEvent(new Event('input', { bubbles: true }))
    resizeChatInput()
  })
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
  const [config, themes] = await Promise.all([window.api.getConfig(), window.api.listThemes()])
  activeConfig = config

  // Load theme list into dropdown
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
        startupBannerText += `${line}\r\n`
      }
    } else if (payload) {
      // 1. Render ASCII banner
      if (payload.asciiBanner) {
        for (const line of payload.asciiBanner.split('\n')) {
          term.writeln(line)
          startupBannerText += `${line}\r\n`
        }
        term.writeln('')
        startupBannerText += '\r\n'
      }

      // 2. Stream health checks with step progression
      if (payload.diagHeader && Array.isArray(payload.healthChecks)) {
        term.writeln(payload.diagHeader)
        startupBannerText += `${payload.diagHeader}\r\n`

        for (const item of payload.healthChecks) {
          updateStatus(`Verifying ${item.title}...`, 'tool', item.title)
          term.writeln(item.formattedRow)
          startupBannerText += `${item.formattedRow}\r\n`
        }

        term.writeln(payload.diagFooter)
        term.writeln('')
        startupBannerText += `${payload.diagFooter}\r\n\r\n`
      }

      // 3. Render Quick Commands guide box
      if (Array.isArray(payload.guideBox)) {
        for (const line of payload.guideBox) {
          term.writeln(line)
          startupBannerText += `${line}\r\n`
        }
        term.writeln('')
        startupBannerText += '\r\n'
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
