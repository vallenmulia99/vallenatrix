import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const renderer = readFileSync(join(root, 'src/renderer/main.ts'), 'utf8')

test('background self-review notice stays in the status bar instead of the answer area', () => {
  const handler = renderer.slice(renderer.indexOf("status.type === 'review_complete'"))
  const body = handler.slice(0, handler.indexOf('}\n})'))
  assert.equal(/appendAgentOutput\([^)]*status\.message/.test(body), false)
  assert.match(body, /updateStatus\(/)
})
