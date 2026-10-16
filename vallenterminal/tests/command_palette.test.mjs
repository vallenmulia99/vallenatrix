import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8')
const renderer = readFileSync(join(root, 'src/renderer/main.ts'), 'utf8')

test('command palette exposes required commands and accessible searchable dialog', () => {
  assert.match(html, /<div id="command-palette"[^>]*role="dialog"/)
  assert.match(html, /<input id="command-palette-search" type="search"/)
  for (const command of ['/help', '/sessions', '/resume', '/theme', '/settings', '/health', '/new']) {
    assert.ok(renderer.includes(`command: '${command}'`), `${command} missing from palette`)
  }
})

test('Ctrl+Shift+P opens palette; keyboard selection and escape work', () => {
  assert.match(renderer, /e\.ctrlKey && e\.shiftKey && e\.key\.toLowerCase\(\) === 'p'/)
  assert.match(renderer, /ArrowDown/)
  assert.match(renderer, /ArrowUp/)
  assert.match(renderer, /e\.key === 'Escape'/)
  assert.match(renderer, /e\.key === 'Enter'/)
  assert.match(renderer, /commandPalette\.classList\.add\('hidden'\)/)
})
