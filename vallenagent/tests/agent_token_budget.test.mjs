import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { DEFAULT_CONFIG } from '../dist/config.js'

test('per-turn token budget caps completion and stops later model calls', async t => {
  const home = mkdtempSync(join(tmpdir(), 'turn-token-budget-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const config = structuredClone(DEFAULT_CONFIG)
  config.max_tokens_per_turn = 20_000
  const agent = new AIAgent({ config, isSubagent: true, maxIterations: 4 })
  let calls = 0
  let requestedMaxTokens
  agent.provider.chat = async request => {
    calls++
    requestedMaxTokens = request.max_tokens
    return { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'budget-call', type: 'function', function: { name: 'skills_list', arguments: '{}' } }] } }], usage: { prompt_tokens: 1, completion_tokens: 20_000 } }
  }
  await assert.rejects(agent.chat('check budget'), /token budget/i)
  assert.equal(calls, 1)
  assert.ok(requestedMaxTokens > 0 && requestedMaxTokens <= config.max_tokens_per_turn)
})
