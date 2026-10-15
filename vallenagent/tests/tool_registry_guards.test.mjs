import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { registry } from '../dist/tools.js'

function register(name, options = {}) {
  let calls = 0
  registry.register({
    name,
    toolset: 'test',
    schema: {
      name,
      description: 'test tool',
      parameters: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value']
      }
    },
    checkFn: options.checkFn,
    handler: async () => { calls++; return JSON.stringify({ ok: true }) }
  })
  return () => calls
}

function initializeAgent(t) {
  const previousHome = process.env.VALLENATRIX_HOME
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-tool-guards-'))
  process.env.VALLENATRIX_HOME = home
  new AIAgent({ isSubagent: true, maxIterations: 1 })
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })
}

test('registry rejects direct execution when tool availability check fails', async () => {
  const name = `guard_unavailable_${Date.now()}`
  const calls = register(name, { checkFn: () => false })
  const result = JSON.parse(await registry.execute(name, { value: 'ok' }))
  assert.match(result.error, /unavailable/i)
  assert.equal(calls(), 0)
})

test('registry rejects malformed arguments before handler execution', async () => {
  const name = `guard_schema_${Date.now()}`
  const calls = register(name)
  const result = JSON.parse(await registry.execute(name, { value: 42 }))
  assert.match(result.error, /value.*string/i)
  assert.equal(calls(), 0)
})

test('registry filter applies at dispatch when no per-call whitelist is passed', async () => {
  const name = `guard_filtered_${Date.now()}`
  const hiddenName = `${name}_hidden`
  const calls = register(hiddenName)
  registry.filterTools([name])
  try {
    const result = JSON.parse(await registry.execute(hiddenName, { value: 'ok' }))
    assert.match(result.error, /not allowed/i)
    assert.equal(calls(), 0)
  } finally {
    registry.clearFilter()
  }
})

test('subagents cannot directly dispatch delegate_task when schema hides it', async () => {
  let calls = 0
  registry.register({
    name: 'delegate_task', toolset: 'test',
    schema: { name: 'delegate_task', description: 'test', parameters: { type: 'object', properties: {} } },
    handler: async () => { calls++; return 'unexpected' }
  })
  const result = JSON.parse(await registry.execute('delegate_task', { tasks: [] }, { isSubagent: true }))
  assert.match(result.error, /not allowed/i)
  assert.equal(calls, 0)
})

 test('registry rejects non-object arguments and missing required keys', async () => {
  const name = `guard_required_${Date.now()}`
  const calls = register(name)
  const nonObject = JSON.parse(await registry.execute(name, null))
  const missing = JSON.parse(await registry.execute(name, {}))
  assert.match(nonObject.error, /object/i)
  assert.match(missing.error, /required.*value/i)
  assert.equal(calls(), 0)
})
