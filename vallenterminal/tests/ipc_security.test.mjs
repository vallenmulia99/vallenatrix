import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')

test('approval IPC accepts only boolean answers from owning window', () => {
  const handler = source.slice(source.indexOf('ipcMain.handle(IPC_CHANNELS.AGENT_APPROVAL'), source.indexOf('ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE'))
  assert.match(handler, /typeof payload\?\.approvalId !== 'string' \|\| typeof payload\.allowed !== 'boolean'/)
  assert.match(handler, /BrowserWindow\.fromWebContents\(event\.sender\) !== mainWindow/)
  assert.match(handler, /pending\.resolve\(payload\.allowed\)/)
  assert.doesNotMatch(handler, /Boolean\(payload\.allowed\)/)
})

test('IPC configuration, theme, external-open, and paste handlers require an app window', () => {
  for (const name of ['PASTE_SAVE', 'CONFIG_GET', 'CONFIG_SAVE', 'THEME_LIST', 'THEME_GET', 'THEME_SAVE', 'SYSTEM_OPEN_EXTERNAL']) {
    const at = source.indexOf(`ipcMain.handle(IPC_CHANNELS.${name}`)
    assert.notEqual(at, -1, `${name} handler exists`)
    const body = source.slice(at, source.indexOf('\n  })', at))
    assert.match(body, /getWindowForSender\(event\.sender\)/, `${name} validates sender`)
  }
})

test('navigation is restricted to exact packaged renderer document', () => {
  const at = source.indexOf("window.webContents.on('will-navigate'")
  const handler = source.slice(at, source.indexOf("\n  })", at))
  assert.match(handler, /target\.protocol === 'file:' && target\.href === appDocument\.href/)
  assert.match(handler, /event\.preventDefault\(\)/)
})

test('pending approval resolves denied when its target window closes', () => {
  const at = source.indexOf('function requestApproval')
  const handler = source.slice(at, source.indexOf('\nfunction createWindow', at))
  assert.match(handler, /target\.once\('closed'/)
  assert.match(handler, /pending\.resolve\(false\)/)
})
