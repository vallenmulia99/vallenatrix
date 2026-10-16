import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/index.html'), 'utf8')
const compact = html.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n    \}/)?.[1] || ''
const narrow = html.match(/@media \(max-width: 460px\) \{([\s\S]*?)\n    \}/)?.[1] || ''

test('compact layout keeps titlebar controls and tabs usable on narrow windows', () => {
  assert.match(compact, /\.titlebar-left\s*\{[^}]*min-width:\s*0/)
  assert.match(compact, /#terminal-tabs\s*\{[^}]*flex:\s*1[^}]*min-width:\s*0/)
  assert.match(compact, /\.titlebar-controls\s*\{[^}]*flex:\s*0\s+0\s+auto/)
  assert.match(compact, /\.titlebar-new-terminal::after\s*\{[^}]*content:\s*'\+'/)
})

test('compact status bar hides secondary telemetry below 640px', () => {
  for (const selector of ['#status-context', '#status-bar-visual', '#status-telemetry', '#status-folder']) {
    assert.ok(compact.includes(selector), `missing compact rule for ${selector}`)
  }
  assert.match(compact, /\.status-left\s*\.status-divider[\s\S]*?display:\s*none/)
})

test('400px layout applies tighter tab and model bounds', () => {
  assert.match(narrow, /\.terminal-tab\s*\{[^}]*max-width:\s*96px/)
  assert.match(narrow, /\.model-select-compact\s*\{[^}]*max-width:\s*118px/)
  assert.match(narrow, /\.btn-icon\s*\{[^}]*width:\s*23px/)
})
