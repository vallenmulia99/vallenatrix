import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/renderer/format.ts'), 'utf8')
const mainSource = readFileSync(join(root, 'src/renderer/main.ts'), 'utf8')

const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const format = await import(`data:text/javascript,${encodeURIComponent(js)}`)
const render = format.renderMarkdownForTerminal

const strip = lines => lines.map(line => line.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')

test('agent response box hides markdown markers and keeps readable text', () => {
  const input = [
    '**Review selesai.** File `broken.js` diaudit.',
    '',
    '### Temuan',
    '- **Ronde 3** rusak: `node broken.js` exit 0',
    '1. fix pembanding',
    '| Item | Status |',
    '|---|---|',
    '| 1 | ok |'
  ].join('\n')
  const output = strip(render(input, '\x1b[38;2;1;2;3m', '\x1b[1;36m', '\x1b[36m'))
  assert.equal(output.includes('**'), false)
  assert.equal(output.includes('`'), false)
  assert.equal(output.includes('###'), false)
  assert.equal(output.includes('|---|'), false)
  assert.match(output, /Review selesai\. File broken\.js diaudit\./)
  assert.match(output, /• Ronde 3 rusak: node broken\.js exit 0/)
  assert.match(output, /1\. fix pembanding/)
  assert.match(output, /Item/)
  assert.match(output, /ok/)
  assert.equal(output.startsWith('\n'), false)
})

test('response box renders every agent line through the markdown formatter', () => {
  const calls = mainSource.match(/renderMarkdownForTerminal\(res\.response/g) || []
  assert.equal(calls.length, 2)
  assert.equal(/colorCode\}\$\{line\}/.test(mainSource), false)
})
