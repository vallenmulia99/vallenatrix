import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8')

test('/health reports runtime diagnostics and distinguishes gateway state', () => {
  const start = main.indexOf("if (cmd === '/health')")
  assert.ok(start >= 0, '/health command missing')
  const command = main.slice(start, start + 1800)
  assert.match(command, /process\.platform/)
  assert.match(command, /process\.memoryUsage\(\)/)
  assert.match(command, /not configured/i)
  assert.match(command, /unreachable/i)
  assert.match(command, /connected/i)
  assert.match(command, /AbortSignal\.timeout\(1500\)/)
  assert.match(main, /\/health\s+-/ )
})
