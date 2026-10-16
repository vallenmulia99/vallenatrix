import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'

const response = (message, calls = []) => ({
  choices: [{ message: { role: 'assistant', content: message, tool_calls: calls }, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
})

test('session resume restores active todo checklist', async t => {
  const home = mkdtempSync(join(tmpdir(), 'task-resume-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const sessionDir = join(home, 'sessions')
  const first = new AIAgent({ sessionId: 'task-resume', sessionDir, backgroundReview: false })
  first.todoStore.write([{ id: 'implement', content: 'Finish implementation and verify tests', status: 'in_progress' }])
  first.sessionManager.saveSession(first.getSessionId(), [{ role: 'system', content: 'system' }, { role: 'user', content: 'finish task' }], process.cwd(), first.provider.model, first.todoStore.read())

  const resumed = new AIAgent({ sessionId: 'new-agent', sessionDir, backgroundReview: false })
  assert.equal(resumed.resumeSession('task-resume'), true)
  assert.deepEqual(resumed.todoStore.read(), [{ id: 'implement', content: 'Finish implementation and verify tests', status: 'in_progress' }])
  let calls = 0
  resumed.provider.chat = async request => {
    calls++
    assert.ok(request.messages.some(message => message.content.includes('Finish implementation and verify tests')))
    return response('I will continue.')
  }
  const result = await resumed.chat('lanjut')
  assert.equal(result.completionStatus, 'incomplete')
  assert.equal(calls, 3)
})

test('one finalization call is allowed when the last budgeted response requests tools', async t => {
  const home = mkdtempSync(join(tmpdir(), 'task-finalization-grace-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const agent = new AIAgent({ maxIterations: 1, isSubagent: true, backgroundReview: false })
  agent.toolWhitelist = ['skills_list']
  let calls = 0
  agent.provider.chat = async () => {
    calls++
    if (calls === 1) return response('', [{ id: 'list-skills', type: 'function', function: { name: 'skills_list', arguments: '{}' } }])
    return response('Done after tool work.')
  }
  const result = await agent.chat('Continue this task')
  assert.equal(calls, 2)
  assert.equal(result.iterations, 2)
  assert.equal(result.completionStatus, 'complete')
  assert.equal(result.response, 'Done after tool work.')
})

test('unfinished checklist blocks false final and runtime continues without streaming premature answer', async t => {
  const home = mkdtempSync(join(tmpdir(), 'task-final-gate-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const agent = new AIAgent({ maxIterations: 5, backgroundReview: false })
  agent.todoStore.write([{ id: 'finish', content: 'Finish task and run tests', status: 'in_progress' }])
  let calls = 0
  const streamed = []
  agent.provider.chat = async request => {
    calls++
    if (calls === 1) {
      request.onChunk?.('Premature: done already.')
      return response('Done already.')
    }
    if (calls === 2) {
      assert.ok(request.messages.some(message => message.content.includes('Finish task and run tests')))
      assert.ok(request.messages.some(message => message.content.toLowerCase().includes('continue working')))
      return response('', [{ id: 'todo-complete', type: 'function', function: { name: 'todo_list', arguments: JSON.stringify({ todos: [{ id: 'finish', status: 'completed' }], merge: true }) } }])
    }
    request.onChunk?.('Completed and verified.')
    return response('Completed and verified.')
  }
  const result = await agent.chat('Finish the task', { onChunk: chunk => streamed.push(chunk) })
  assert.equal(calls, 3)
  assert.equal(result.response, 'Completed and verified.')
  assert.equal(result.completionStatus, 'complete')
  assert.deepEqual(streamed, ['Completed and verified.'])
  assert.deepEqual(agent.sessionManager.loadSession(agent.getSessionId()).todos, [{ id: 'finish', content: 'Finish task and run tests', status: 'completed' }])
})

test('action task receives runtime checklist before first provider call', async t => {
  const home = mkdtempSync(join(tmpdir(), 'task-autotrack-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const agent = new AIAgent({ maxIterations: 5, backgroundReview: false })
  let calls = 0
  agent.provider.chat = async request => {
    calls++
    assert.ok(request.messages.some(message => message.content.includes('[Current task tracker;')))
    if (calls === 1) return response('Done already.')
    if (calls === 2) {
      const todos = agent.todoStore.read().map(todo => ({ id: todo.id, status: 'completed' }))
      return response('', [{ id: 'goal-complete', type: 'function', function: { name: 'todo_list', arguments: JSON.stringify({ todos, merge: true }) } }])
    }
    return response('Finished and verified.')
  }
  const result = await agent.chat('Fix the failing test and run the suite')
  assert.equal(calls, 3)
  assert.equal(result.response, 'Finished and verified.')
  assert.equal(result.completionStatus, 'complete')
})

test('a question asking how to fix something does not become an execution checklist', async t => {
  const home = mkdtempSync(join(tmpdir(), 'task-question-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const agent = new AIAgent({ backgroundReview: false })
  agent.provider.chat = async request => {
    assert.equal(request.messages.some(message => message.content.includes('[Current task tracker;')), false)
    return response('Check the failing assertion first.')
  }
  const result = await agent.chat('How do I fix this test?')
  assert.equal(result.response, 'Check the failing assertion first.')
  assert.equal(result.completionStatus, 'complete')
})

test('repeated premature finals return explicit incomplete status with remaining tasks', async t => {
  const home = mkdtempSync(join(tmpdir(), 'task-incomplete-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const agent = new AIAgent({ maxIterations: 6, backgroundReview: false })
  agent.todoStore.write([{ id: 'verify', content: 'Run tests and inspect results', status: 'pending' }])
  let calls = 0
  agent.provider.chat = async () => { calls++; return response('Looks done to me.') }
  const result = await agent.chat('Fix and verify this project')
  assert.equal(calls, 3)
  assert.equal(result.completionStatus, 'incomplete')
  assert.match(result.response, /Run tests and inspect results/)
})
