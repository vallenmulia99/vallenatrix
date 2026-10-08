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
