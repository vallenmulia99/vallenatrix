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
  // Long history (>80 messages) is compacted; the tool-call group sits on the compaction boundary and must stay intact.
  for (let i = 1; i <= 75; i++) history.push({ role: 'user', content: `old ${i}` })
  history.push({
    role: 'assistant',
    content: '',
    tool_calls: ['call-a', 'call-b'].map(id => ({ id, type: 'function', function: { name: 'test', arguments: '{}' } }))
  })
  history.push({ role: 'tool', tool_call_id: 'call-a', name: 'test', content: 'a' })
  history.push({ role: 'tool', tool_call_id: 'call-b', name: 'test', content: 'b' })
  while (history.length < 85) history.push({ role: 'user', content: `tail ${history.length}` })
  agent.conversationHistory = history

  let requestMessages
  agent.provider.chat = async ({ messages }) => {
    requestMessages = messages
    return { choices: [{ message: { content: 'done' } }] }
  }
  await agent.chat('latest')

  const messageIndex = requestMessages.findIndex(m => m.role === 'assistant' && m.tool_calls?.length)
  assert.ok(messageIndex >= 0)
  const calls = requestMessages[messageIndex].tool_calls.map(call => call.id)
  const results = requestMessages.slice(messageIndex + 1).filter(m => m.role === 'tool').map(m => m.tool_call_id)
  assert.deepEqual(results.slice(0, calls.length), calls)
  assert.ok(requestMessages.some(m => m.role === 'user' && m.content.includes('Previous conversation summary')))
})

test('malformed tool arguments still emit paired start and error completion events', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-tool-lifecycle-'))
  const previousHome = process.env.VALLENATRIX_HOME
  process.env.VALLENATRIX_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  const agent = new AIAgent({ isSubagent: true })
  let requestCount = 0
  agent.provider.chat = async () => {
    requestCount++
    if (requestCount === 1) return { choices: [{ message: { content: '', tool_calls: [{
      id: 'bad-args', type: 'function', function: { name: 'read_file', arguments: '{broken' }
    }] } }] }
    return { choices: [{ message: { content: 'done' } }] }
  }
  const events = []
  await agent.chat('trigger malformed call', {
    onToolStart: event => events.push({ type: 'start', ...event }),
    onToolEnd: event => events.push({ type: 'end', ...event })
  })
  assert.deepEqual(events.map(event => event.type), ['start', 'end'])
  assert.equal(events[0].id, events[1].id)
  assert.match(events[1].result, /Invalid JSON arguments/)
  assert.match(events[1].preview, /error/i)
})

test('system prompt remains byte-stable across turns even when caller supplies a new prompt', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-prompt-cache-'))
  const previousHome = process.env.VALLENATRIX_HOME
  process.env.VALLENATRIX_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  const agent = new AIAgent({ isSubagent: true })
  const prompts = []
  agent.provider.chat = async ({ messages }) => {
    prompts.push(messages[0].content)
    return { choices: [{ message: { content: 'done' } }] }
  }
  await agent.chat('first', undefined, 'session prompt')
  await agent.chat('second', undefined, 'different prompt')
  assert.deepEqual(prompts, ['session prompt', 'session prompt'])
})

test('reset clears cached prompt for next session', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-prompt-reset-'))
  const previousHome = process.env.VALLENATRIX_HOME
  process.env.VALLENATRIX_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })
  const agent = new AIAgent({ isSubagent: true })
  const prompts = []
  agent.provider.chat = async ({ messages }) => { prompts.push(messages[0].content); return { choices: [{ message: { content: 'done' } }] } }
  await agent.chat('first', undefined, 'old session')
  agent.resetSession('next-session')
  await agent.chat('next', undefined, 'new session')
  assert.deepEqual(prompts, ['old session', 'new session'])
})

test('resumed session keeps its persisted system prompt unchanged', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-prompt-resume-'))
  const previousHome = process.env.VALLENATRIX_HOME
  process.env.VALLENATRIX_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })
  const sessionDir = join(home, 'sessions')
  const agent = new AIAgent({ sessionDir, backgroundReview: false })
  agent.provider.chat = async () => ({ choices: [{ message: { content: 'done' } }] })
  await agent.chat('first', undefined, 'persisted prompt')
  const resumed = new AIAgent({ isSubagent: true, sessionDir })
  assert.equal(resumed.resumeSession(agent.getSessionId()), true)
  let prompt
  resumed.provider.chat = async ({ messages }) => { prompt = messages[0].content; return { choices: [{ message: { content: 'done' } }] } }
  await resumed.chat('second', undefined, 'ignored replacement')
  assert.equal(prompt, 'persisted prompt')
})
