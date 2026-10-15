import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent, compactHistory, compactActiveTurn, pruneOldToolResults } from '../dist/agent.js'
import { DEFAULT_CONFIG } from '../dist/config.js'

function makeAgent(t, opts = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ctx-retention-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const config = structuredClone(DEFAULT_CONFIG)
  Object.assign(config, opts.config || {})
  return new AIAgent({ config, isSubagent: opts.isSubagent ?? true, maxIterations: opts.maxIterations ?? 60, backgroundReview: false })
}

const toolCall = (id, name = 'skills_list', args = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })

test('prompt tokens do not consume the per-turn budget (large context, many iterations)', async t => {
  const agent = makeAgent(t, { config: { max_tokens_per_turn: 50_000 } })
  let calls = 0
  agent.provider.chat = async () => {
    calls++
    if (calls <= 12) {
      return { choices: [{ message: { role: 'assistant', content: '', tool_calls: [toolCall(`c${calls}`)] } }], usage: { prompt_tokens: 30_000, completion_tokens: 200 } }
    }
    return { choices: [{ message: { role: 'assistant', content: 'all done' } }], usage: { prompt_tokens: 30_000, completion_tokens: 50 } }
  }
  const result = await agent.chat('check budget')
  assert.equal(result.response, 'all done')
  assert.equal(calls, 13)
})

test('per-request max_tokens is capped so models with small output limits are not rejected', async t => {
  const agent = makeAgent(t, { config: { max_tokens_per_turn: 400_000 } })
  let requested
  agent.provider.chat = async request => { requested = request.max_tokens; return { choices: [{ message: { content: 'ok' } }] } }
  await agent.chat('hello')
  assert.equal(requested, 16_384)
})

test('config temperature is forwarded to the provider only when set', async t => {
  const agent = makeAgent(t, { config: { temperature: 0.2 } })
  let temp = 'unset'
  agent.provider.chat = async request => { temp = request.temperature; return { choices: [{ message: { content: 'ok' } }] } }
  await agent.chat('hello')
  assert.equal(temp, 0.2)
  const plain = makeAgent(t)
  plain.provider.chat = async request => { temp = request.temperature; return { choices: [{ message: { content: 'ok' } }] } }
  await plain.chat('hello')
  assert.equal(temp, undefined)
})

test('compaction keeps the NEWEST steps and the original task, not just the oldest 15 lines', () => {
  const history = [{ role: 'system', content: 'system' }, { role: 'user', content: 'ORIGINAL_TASK build the app' }]
  for (let i = 0; i < 60; i++) history.push({ role: 'assistant', content: `step-${i}` })
  compactHistory(history, 8)
  const summary = history.find(m => m.role === 'user' && m.content.startsWith('[Previous conversation summary'))
  assert.ok(summary.content.includes('ORIGINAL_TASK'))
  assert.ok(summary.content.includes('step-51'), 'newest compacted step must survive')
  assert.ok(summary.content.includes('step-20'), 'middle steps must survive, not only the first 15')
})

test('compaction records tool calls and files touched', () => {
  const history = [{ role: 'system', content: 'system' }, { role: 'user', content: 'task' }]
  history.push({ role: 'assistant', content: '', tool_calls: [toolCall('w1', 'write_file', { path: 'src/app.ts', content: 'x' })] })
  history.push({ role: 'tool', tool_call_id: 'w1', name: 'write_file', content: JSON.stringify({ ok: true }) })
  for (let i = 0; i < 12; i++) history.push({ role: 'assistant', content: `later ${i}` })
  compactHistory(history, 8)
  const summary = history.find(m => m.role === 'user' && m.content.startsWith('[Previous conversation summary'))
  assert.match(summary.content, /Called write_file\(src\/app\.ts\)/)
  assert.match(summary.content, /Files touched: .*src\/app\.ts/)
})

test('summary stays bounded across many compactions and keeps pinned original task', () => {
  const history = [{ role: 'system', content: 'system' }, { role: 'user', content: 'PINNED_ORIGINAL' }]
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < 30; i++) history.push({ role: 'assistant', content: `round ${round} step ${i} ${'y'.repeat(300)}` })
    compactHistory(history, 8)
  }
  const summary = history.find(m => m.role === 'user' && m.content.startsWith('[Previous conversation summary'))
  assert.ok(summary.content.length < 17_000)
  assert.ok(summary.content.includes('PINNED_ORIGINAL'))
  assert.ok(summary.content.includes('round 9 step'))
})

test('active-turn compaction shrinks a long single turn and keeps tool calls paired', () => {
  const current = { role: 'user', content: 'BIG_TASK build everything' }
  const history = [{ role: 'system', content: 'system' }, current]
  for (let i = 0; i < 30; i++) {
    history.push({ role: 'assistant', content: '', tool_calls: [toolCall(`t${i}`, 'read_file', { path: `src/f${i}.ts` })] })
    history.push({ role: 'tool', tool_call_id: `t${i}`, name: 'read_file', content: `contents ${i} ${'z'.repeat(2000)}` })
  }
  const before = history.length
  assert.equal(compactActiveTurn(history, current, 12), true)
  assert.ok(history.length < before)
  assert.ok(current.content.startsWith('BIG_TASK build everything'))
  assert.match(current.content, /Files touched: .*src\/f0\.ts/)
  const callIds = new Set(history.flatMap(m => m.tool_calls || []).map(c => c.id))
  for (const m of history.filter(x => x.role === 'tool')) assert.ok(callIds.has(m.tool_call_id), 'no orphan tool result')
  for (const id of callIds) assert.ok(history.some(m => m.role === 'tool' && m.tool_call_id === id), 'no missing result')
  // second compaction merges instead of nesting
  for (let i = 30; i < 50; i++) {
    history.push({ role: 'assistant', content: '', tool_calls: [toolCall(`t${i}`, 'read_file', { path: `src/f${i}.ts` })] })
    history.push({ role: 'tool', tool_call_id: `t${i}`, name: 'read_file', content: 'more' })
  }
  assert.equal(compactActiveTurn(history, current, 12), true)
  assert.equal(current.content.split('[Progress so far in this task').length, 2)
  assert.match(current.content, /src\/f40\.ts/)
})

test('a long single turn survives a small context window instead of dying', async t => {
  const agent = makeAgent(t, { maxIterations: 80 })
  const model = agent.provider.model
  agent.config.context_windows = { [model]: 12_000 }
  let calls = 0
  let maxSent = 0
  agent.provider.chat = async ({ messages }) => {
    calls++
    maxSent = Math.max(maxSent, JSON.stringify(messages).length)
    if (calls <= 40) return { choices: [{ message: { role: 'assistant', content: '', tool_calls: [toolCall(`big${calls}`, 'skills_list')] } }] }
    return { choices: [{ message: { role: 'assistant', content: 'finished' } }] }
  }
  // make every tool result large
  const { registry } = await import('../dist/tools.js')
  const original = registry.get('skills_list')
  const handler = original.handler
  original.handler = async (...args) => { await handler(...args); return JSON.stringify({ blob: 'q'.repeat(6_000) }) }
  t.after(() => { original.handler = handler })
  const result = await agent.chat('LONG_JOB list skills many times')
  assert.equal(result.response, 'finished')
  assert.ok(maxSent < 12_000 * 4 * 1.1, `request stayed near the window (${maxSent} chars)`)
})

test('old tool output keeps a head preview when pruned and short outputs are untouched', () => {
  const history = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]
  history.push({ role: 'assistant', content: '', tool_calls: [toolCall('a', 'read_file')] })
  history.push({ role: 'tool', tool_call_id: 'a', name: 'read_file', content: `HEAD_MARKER ${'k'.repeat(5000)}` })
  history.push({ role: 'assistant', content: '', tool_calls: [toolCall('b', 'read_file')] })
  history.push({ role: 'tool', tool_call_id: 'b', name: 'read_file', content: 'short result' })
  for (let i = 0; i < 10; i++) history.push({ role: 'assistant', content: `tail ${i}` })
  const pruned = pruneOldToolResults(history, 6, 1)
  assert.match(pruned[3].content, /pruned to save context/)
  assert.match(pruned[3].content, /HEAD_MARKER/)
  assert.equal(pruned[5].content, 'short result')
  assert.notEqual(pruned, history)
})

test('request-only task tracker never leaks into persisted history on short sessions', async t => {
  const agent = makeAgent(t, { isSubagent: false })
  let calls = 0
  agent.provider.chat = async () => {
    calls++
    if (calls < 4) return { choices: [{ message: { role: 'assistant', content: '', tool_calls: [toolCall(`s${calls}`)] } }] }
    return { choices: [{ message: { role: 'assistant', content: 'Selesai.' } }] }
  }
  agent.todoStore.write([{ id: 'x', content: 'track me', status: 'completed' }])
  await agent.chat('hello')
  assert.equal(agent.conversationHistory.filter(m => typeof m.content === 'string' && m.content.includes('[Current task tracker')).length, 0)
})

test('auto-generated goal is accepted after one nudge when the model already did tool work', async t => {
  const agent = makeAgent(t, { isSubagent: false })
  let calls = 0
  agent.provider.chat = async () => {
    calls++
    if (calls === 1) return { choices: [{ message: { role: 'assistant', content: '', tool_calls: [toolCall('w')] } }] }
    return { choices: [{ message: { role: 'assistant', content: 'Sudah beres, ini hasilnya.' } }] }
  }
  const result = await agent.chat('Fix the login bug and run the tests')
  assert.equal(result.completionStatus, 'complete')
  assert.equal(result.response, 'Sudah beres, ini hasilnya.')
  assert.equal(calls, 3)
  assert.ok(agent.todoStore.read().every(todo => todo.status === 'completed'))
})

test('incomplete report keeps the model last answer instead of discarding it', async t => {
  const agent = makeAgent(t, { isSubagent: false, maxIterations: 8 })
  agent.todoStore.write([{ id: 'manual-goal', content: 'Verify everything', status: 'pending' }])
  agent.provider.chat = async () => ({ choices: [{ message: { role: 'assistant', content: 'MODEL_LAST_WORDS' } }] })
  const result = await agent.chat('lanjut')
  assert.equal(result.completionStatus, 'incomplete')
  assert.match(result.response, /MODEL_LAST_WORDS/)
  assert.match(result.response, /Verify everything/)
})
