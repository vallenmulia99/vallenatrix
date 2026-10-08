import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'

test('history compaction keeps tool-call messages with matching results', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-history-'))
  const previousHome = process.env.VALLENATRIX_HOME
  process.env.VALLENATRIX_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  const agent = new AIAgent({ isSubagent: true })
  const history = [{ role: 'system', content: 'system' }]
  for (let i = 1; i <= 11; i++) history.push({ role: 'user', content: `old ${i}` })
  history.push({
    role: 'assistant',
    content: '',
    tool_calls: ['call-a', 'call-b'].map(id => ({ id, type: 'function', function: { name: 'test', arguments: '{}' } }))
  })
  history.push({ role: 'tool', tool_call_id: 'call-a', name: 'test', content: 'a' })
  history.push({ role: 'tool', tool_call_id: 'call-b', name: 'test', content: 'b' })
  while (history.length < 21) history.push({ role: 'user', content: `tail ${history.length}` })
  agent.conversationHistory = history

  let requestMessages
  agent.provider.chat = async ({ messages }) => {
    requestMessages = messages
    return { choices: [{ message: { content: 'done' } }] }
  }
  await agent.chat('latest')

  const message = requestMessages.find(m => m.role === 'assistant' && m.tool_calls?.length)
  assert.equal(message, undefined)
  assert.ok(requestMessages.some(m => m.role === 'user' && m.content.includes('Previous conversation summary')))
})
