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
