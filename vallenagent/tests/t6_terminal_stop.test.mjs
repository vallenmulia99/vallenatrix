import test from 'node:test'
import assert from 'node:assert/strict'
import { registry } from '../dist/tools.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

test('terminal with sleep 30 aborted completes in under 2s', async () => {
  registerBuiltinTools(null, null, null, async () => '', false)
  const ac = new AbortController()
  const start = Date.now()
  setTimeout(() => ac.abort(), 100)

  const res = JSON.parse(await registry.execute('terminal', { command: 'sleep 30' }, {}, undefined, ac.signal))
  const duration = (Date.now() - start) / 1000
  assert.ok(duration < 2, `Expected < 2s, took ${duration}s`)
  assert.equal(res.exit_code, 130)
  assert.match(res.error, /Interrupted/)
})
