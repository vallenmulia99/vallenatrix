import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/renderer/pet.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
})
const module = { exports: {} }
const load = runInNewContext(`(function(exports, require, module) { ${outputText} })`, {})
load(module.exports, createRequire(import.meta.url), module)

test('pet skips replacing unchanged SVG frame', () => {
  let writes = 0
  let html = ''
  const sprite = Object.defineProperty({}, 'innerHTML', {
    get: () => html,
    set: (value) => { writes++; html = value }
  })
  const setFrameIfChanged = module.exports.setFrameIfChanged
  let current = setFrameIfChanged(sprite, '<svg>idle</svg>', '')
  current = setFrameIfChanged(sprite, '<svg>idle</svg>', current)
  assert.equal(writes, 1)
  assert.equal(html, '<svg>idle</svg>')
  assert.equal(current, '<svg>idle</svg>')
})

test('pet roster includes requested character colors and persists selection', () => {
  assert.match(source, /robot: \{ emoji: '🤖', color: '#ff9b42'/)
  assert.match(source, /slime: \{ emoji: '🟢', color: '#168cff'/)
  assert.match(source, /fox: \{ emoji: '🦊', color: '#f3eee8'/)
  for (const pet of ['rabbit', 'penguin', 'panda', 'tanuki', 'chick', 'dragon', 'kitsune', 'neko', 'spirit', 'dango']) assert.match(source, new RegExp(`${pet}:`))
  assert.match(source, /localStorage\.setItem\('vallen_pet_kind', kind\)/)
  assert.match(source, /this\.kind === 'cat'/)
})

test('settings expose labeled sections and companion selector', () => {
  const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8')
  assert.match(html, /settings-section-title">Tampilan/)
  assert.match(html, /settings-section-title">Latar belakang/)
  assert.match(html, /settings-section-title">Teman terminal/)
  assert.match(html, /id="setting-pet-kind"/)
})

test('send button and pets use cyan accent; interface motion and shadows disabled', () => {
  const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8')
  assert.match(html, /\.btn-send-chat \{\s*background: #05d9e8;/)
  assert.match(html, /animation: none !important;\s*transition: none !important;/)
  assert.match(html, /box-shadow: none !important;\s*backdrop-filter: none !important;/)
  assert.doesNotMatch(html, /\.btn-send-chat \{\s*background: linear-gradient/)
  assert.match(source, /fill="#05d9e8"/)
})
