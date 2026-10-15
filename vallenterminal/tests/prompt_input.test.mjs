import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
function loadTs(relativePath) {
  const source = readFileSync(join(root, relativePath), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
  })
  const mod = { exports: {} }
  const load = runInNewContext(`(function(exports, require, module) { ${outputText} })`, {})
  load(mod.exports, createRequire(import.meta.url), mod)
  return mod.exports
}

const helpersPresent = existsSync(join(root, 'src/shared/prompt-input.ts')) && existsSync(join(root, 'src/main/paste-store.ts'))
const prompt = helpersPresent ? loadTs('src/shared/prompt-input.ts') : {}
const pasteStore = helpersPresent ? loadTs('src/main/paste-store.ts') : {}

test('prompt and paste helpers exist', () => {
  assert.equal(helpersPresent, true, 'prompt formatting and secure paste storage helpers are missing')
})

test('prompt cleanup trims only outside blank lines, normalizes newlines, preserves code indentation', { skip: !helpersPresent }, () => {
  const source = '\r\nTolong cek XML:\r\n    <Root>\r\n      <Child />\r\n    </Root>\r\n'
  assert.equal(prompt.normalizePrompt(source), 'Tolong cek XML:\n    <Root>\n      <Child />\n    </Root>')
  assert.equal(prompt.normalizePrompt('  <Root/>'), '  <Root/>')
})

test('long paste threshold detects large text by characters or lines', { skip: !helpersPresent }, () => {
  assert.equal(prompt.shouldOffloadPaste('x'.repeat(prompt.PASTE_INLINE_MAX_CHARS + 1)), true)
  assert.equal(prompt.shouldOffloadPaste(Array(prompt.PASTE_INLINE_MAX_LINES + 1).fill('line').join('\n')), true)
  assert.equal(prompt.shouldOffloadPaste('short\nmultiline'), false)
})

test('agent prompt lists saved paste paths and instructs reading exact source', { skip: !helpersPresent }, () => {
  const result = prompt.buildPromptForAgent('Tolong cek [pasted text #1: 2 lines]', [
    { path: '/home/user/.vallenatrix/pastes/vallenatrix_paste_1_1.txt', lines: 2, characters: 18 }
  ])
  assert.match(result, /Tolong cek \[pasted text #1: 2 lines\]/)
  assert.match(result, /read_file/)
  assert.match(result, /vallenatrix_paste_1_1\.txt/)
  assert.match(result, /verbatim/)
})

test('paste store saves source verbatim with private directory and file permissions', { skip: !helpersPresent }, () => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-paste-test-'))
  try {
    const source = '<?xml version="1.0"?>\n<Root>\n  <Item />\n</Root>\n'
    const result = pasteStore.savePastedText(home, source)
    assert.equal(readFileSync(result.path, 'utf8'), source)
    assert.equal(result.lines, 4)
    assert.equal(result.characters, source.length)
    assert.match(result.path, /\.vallenatrix\/pastes\/vallenatrix_paste_\d+_\d+\.txt$/)
    assert.equal(statSync(join(home, '.vallenatrix', 'pastes')).mode & 0o777, 0o700)
    assert.equal(statSync(result.path).mode & 0o777, 0o600)
    assert.equal(readdirSync(join(home, '.vallenatrix', 'pastes')).length, 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('paste store rejects oversized source before writing', { skip: !helpersPresent }, () => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-paste-limit-'))
  try {
    assert.throws(() => pasteStore.savePastedText(home, 'x'.repeat(pasteStore.MAX_PASTE_BYTES + 1)), /too large/i)
    assert.equal(readdirSync(home).length, 0)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('paste store refuses symlinked storage directory', { skip: !helpersPresent }, () => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-paste-home-'))
  const outside = mkdtempSync(join(tmpdir(), 'vallenatrix-paste-outside-'))
  try {
    symlinkSync(outside, join(home, '.vallenatrix'), 'dir')
    assert.throws(() => pasteStore.savePastedText(home, 'paste'), /must not be a symlink/i)
    assert.equal(readdirSync(outside).length, 0)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})


test('renderer wires multiline input, large-paste offload, and structured agent prompt', () => {
  const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8')
  const renderer = readFileSync(join(root, 'src/renderer/main.ts'), 'utf8')
  const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
  const preload = readFileSync(join(root, 'src/preload/index.ts'), 'utf8')
  assert.match(html, /<textarea id="chat-input"/)
  assert.match(html, /max-height: 180px/)
  assert.match(renderer, /e\.key === 'Enter' && !e\.shiftKey/)
  assert.match(renderer, /addEventListener\('paste'/)
  assert.match(renderer, /window\.api\.savePastedText\(text\)/)
  assert.match(renderer, /buildPromptForAgent\(/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC_CHANNELS\.PASTE_SAVE, text\)/)
  assert.match(main, /savePastedText\(homedir\(\), text\)/)
})
