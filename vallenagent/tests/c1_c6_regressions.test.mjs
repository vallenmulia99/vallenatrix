import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { registry } from '../dist/tools.js'

const createAgent = () => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-c1-c6-'))
  process.env.VALLENATRIX_HOME = home
  const agent = new AIAgent({ isSubagent: true, maxIterations: 2 })
  return { agent, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

test('tool whitelist scoped per agent, preserving registry visibility', async t => {
  const { agent, cleanup } = createAgent()
  t.after(cleanup)
  agent.toolWhitelist = ['skills_list']
  let schemas
  agent.provider.chat = async request => {
    schemas = request.tools
    return { choices: [{ message: { content: 'ok' } }] }
  }
  await agent.chat('check')
  assert.ok(schemas.some(tool => tool.function.name === 'skills_list'))
  assert.ok(!schemas.some(tool => tool.function.name === 'terminal'))
  assert.ok(registry.getOpenAISchemas().some(tool => tool.function.name === 'terminal'))
  assert.match(await registry.execute('terminal', {}, {}, ['skills_list']), /Tool not allowed/)
})

test('empty tool arguments parse as object and execute tool', async t => {
  const { agent, cleanup } = createAgent()
  t.after(cleanup)
  let pass = false
  agent.provider.chat = async ({ messages }) => {
    if (!pass) {
      pass = true
      return { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'skills_list', arguments: '' } }] } }] }
    }
    assert.ok(messages.some(message => message.role === 'tool' && message.tool_call_id === 'c1' && !message.content.includes('Invalid JSON')))
    return { choices: [{ message: { content: 'done' } }] }
  }
  await agent.chat('list skills')
})

test('read-only tool batches run with bounded concurrency and preserve result order', async t => {
  const { agent, cleanup } = createAgent()
  t.after(cleanup)
  const names = Array.from({ length: 6 }, (_, index) => `test_parallel_read_${index}`)
  let active = 0
  let maximum = 0
  const events = []
  names.forEach((name, index) => registry.register({
    name,
    toolset: 'test',
    parallelSafe: true,
    schema: { name, description: name, parameters: { type: 'object', properties: {} } },
    handler: async () => {
      active++
      maximum = Math.max(maximum, active)
      events.push(`start:${index}`)
      await new Promise(resolve => setTimeout(resolve, 30))
      events.push(`end:${index}`)
      active--
      return `result-${index}`
    }
  }))
  agent.toolWhitelist = names
  let pass = false
  agent.provider.chat = async ({ messages }) => {
    if (!pass) {
      pass = true
      return { choices: [{ message: { content: '', tool_calls: names.map((name, index) => ({
        id: `parallel-${index}`, type: 'function', function: { name, arguments: '{}' }
      })) } }] }
    }
    assert.deepEqual(messages.filter(message => message.role === 'tool').map(message => message.tool_call_id), names.map((_, index) => `parallel-${index}`))
    return { choices: [{ message: { content: 'done' } }] }
  }
  await agent.chat('read six independent items')
  assert.equal(maximum, 4)
  assert.deepEqual(events.filter(event => event.startsWith('start:')).slice(0, 4), ['start:0', 'start:1', 'start:2', 'start:3'])
  assert.ok(events.indexOf('start:4') > events.indexOf('end:3'))
})

test('duplicate model tool-call IDs become distinct paired history entries', async t => {
  const { agent, cleanup } = createAgent()
  t.after(cleanup)
  let pass = false
  agent.provider.chat = async ({ messages }) => {
    if (!pass) {
      pass = true
      return { choices: [{ message: { content: '', tool_calls: [
        { id: 'duplicate', type: 'function', function: { name: 'skills_list', arguments: '{}' } },
        { id: 'duplicate', type: 'function', function: { name: 'skills_list', arguments: '{}' } }
      ] } }] }
    }
    const calls = messages.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls || [])
    const results = messages.filter(message => message.role === 'tool')
    assert.equal(new Set(calls.map(call => call.id)).size, 2)
    assert.deepEqual(new Set(results.map(result => result.tool_call_id)), new Set(calls.map(call => call.id)))
    return { choices: [{ message: { content: 'done' } }] }
  }
  await agent.chat('list skills twice')
})

test('estimated prompt size compacts large prior messages before provider call', async t => {
  const { agent, cleanup } = createAgent()
  t.after(cleanup)
  const model = agent.provider.model
  agent.config.context_windows = { [model]: 16_000 }
  agent.conversationHistory = [
    { role: 'system', content: 'previous system prompt' },
    { role: 'user', content: 'OLD_TASK_MARKER old request' },
    { role: 'assistant', content: `OLD_DETAIL_MARKER ${'x'.repeat(100_000)}` }
  ]
  let sent
  agent.provider.chat = async ({ messages }) => {
    sent = messages
    return { choices: [{ message: { content: 'done' } }] }
  }
  await agent.chat('CURRENT_TASK_MARKER continue')
  assert.ok(sent.some(message => message.role === 'user' && message.content.includes('CURRENT_TASK_MARKER')))
  assert.ok(sent.some(message => message.role === 'user' && message.content.includes('OLD_TASK_MARKER')))
  assert.ok(!sent.some(message => message.content.includes('x'.repeat(1_000))))
})

test('oversized active request fails before provider call rather than dropping user text', async t => {
  const { agent, cleanup } = createAgent()
  t.after(cleanup)
  const model = agent.provider.model
  agent.config.context_windows = { [model]: 2_000 }
  let calls = 0
  agent.provider.chat = async () => { calls++; return { choices: [{ message: { content: 'unexpected' } }] } }
  await assert.rejects(() => agent.chat(`KEEP_THIS_REQUEST ${'x'.repeat(100_000)}`), /exceeds configured context window/i)
  assert.equal(calls, 0)
})

test('compaction boundary retains whole multi-tool call groups', async t => {
  const { agent, cleanup } = createAgent()
  t.after(cleanup)
  const history = [{ role: 'system', content: 'system' }, { role: 'user', content: 'prior task' }]
  for (let i = 0; i < 15; i++) history.push({ role: 'assistant', content: `old ${i}` })
  const calls = ['one', 'two', 'three'].map(id => ({ id, type: 'function', function: { name: 'skills_list', arguments: '{}' } }))
  history.push({ role: 'assistant', content: '', tool_calls: calls })
  for (const call of calls) history.push({ role: 'tool', tool_call_id: call.id, name: 'skills_list', content: `result ${call.id}` })
  for (let i = 0; i < 5; i++) history.push({ role: 'assistant', content: `recent ${i}` })
  agent.conversationHistory = history
  let sent
  agent.provider.chat = async request => { sent = request.messages; return { choices: [{ message: { content: 'done' } }] } }
  await agent.chat('current task')
  const batch = sent.find(message => message.role === 'assistant' && message.tool_calls?.length)
  assert.equal(batch?.tool_calls?.length, 3)
  assert.deepEqual(sent.filter(message => message.role === 'tool').map(message => message.tool_call_id).sort(), ['one', 'three', 'two'])
})

test('history compaction retains current task and keeps tool calls paired', async t => {
  const { agent, cleanup } = createAgent()
  t.after(cleanup)
  const history = [{ role: 'system', content: 'system' }, { role: 'user', content: 'original task with critical detail at end' }]
  for (let i = 0; i < 18; i++) history.push({ role: 'assistant', content: `step ${i}` })
  history.push({ role: 'assistant', content: '', tool_calls: [{ id: 'call', type: 'function', function: { name: 'x', arguments: '{}' } }] })
  history.push({ role: 'tool', tool_call_id: 'call', name: 'x', content: 'result' })
  agent.conversationHistory = history
  let sent
  agent.provider.chat = async ({ messages }) => {
    sent = messages
    return { choices: [{ message: { content: 'done' } }] }
  }
  await agent.chat('continue')
  assert.ok(sent.some(message => message.role === 'user' && message.content.includes('critical detail at end')))
  const ids = new Set(sent.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls || []).map(call => call.id))
  for (const result of sent.filter(message => message.role === 'tool')) assert.ok(ids.has(result.tool_call_id))
})
