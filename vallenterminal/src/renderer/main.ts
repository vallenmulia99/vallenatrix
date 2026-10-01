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

// Two-way PTY Communication
term.onData((data) => {
  window.api.sendTerminalData(data)
  pet.onUserActivity()
})

window.api.onTerminalData((data) => {
  term.write(data)
})

window.addEventListener('resize', () => {
  fitAddon.fit()
  window.api.resizeTerminal(term.cols, term.rows)
})

// Window Controls
btnMinimize.addEventListener('click', () => window.api.minimizeWindow())
btnMaximize.addEventListener('click', () => window.api.maximizeWindow())
btnClose.addEventListener('click', () => window.api.closeWindow())

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
    foreground: '#ffffff',
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
    white: '#ffffff',
    brightBlack: theme.colors.brightBlack,
    brightRed: theme.colors.brightRed,
    brightGreen: theme.colors.brightGreen,
    brightYellow: theme.colors.brightYellow,
    brightBlue: theme.colors.brightBlue,
    brightMagenta: theme.colors.brightMagenta,
    brightCyan: theme.colors.brightCyan,
    brightWhite: '#ffffff'
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

  if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
    e.preventDefault()
    const text = await navigator.clipboard.readText()
    if (text) {
      term.paste(text)
    }
    return
  }
})

// Middle-click to paste into terminal
terminalContainer.addEventListener('auxclick', async (e) => {
  if (e.button === 1) {
    e.preventDefault()
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        term.paste(text)
      }
    } catch {
      // Clipboard read failed
    }
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

sliderDim.addEventListener('input', async () => {
  const val = Number(sliderDim.value) / 100
  labelDim.textContent = `${sliderDim.value}%`
  activeConfig.background.dim = val
  applyBackground()
  await window.api.saveConfig({ background: activeConfig.background })
})

sliderMediaOpacity.addEventListener('input', async () => {
  const val = Number(sliderMediaOpacity.value) / 100
  labelMediaOpacity.textContent = `${sliderMediaOpacity.value}%`
  activeConfig.background.opacity = val
  applyBackground()
  await window.api.saveConfig({ background: activeConfig.background })
})

sliderWinOpacity.addEventListener('input', async () => {
  const val = Number(sliderWinOpacity.value) / 100
  labelWinOpacity.textContent = `${sliderWinOpacity.value}%`
  activeConfig.windowOpacity = val
  applyBackground()
  await window.api.saveConfig({ windowOpacity: val })
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

  applyBackground()
  updateSettingsForm()

  fitAddon.fit()
  window.api.resizeTerminal(term.cols, term.rows)
}

init().catch(console.error)
