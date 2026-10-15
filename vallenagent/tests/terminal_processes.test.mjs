import test from 'node:test'
import assert from 'node:assert/strict'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

function setup() {
  registerBuiltinTools(new SkillLoader([]), undefined, undefined, undefined, false)
}

test('terminal background process can be polled and killed by session id', async () => {
  setup()
  const start = JSON.parse(await registry.execute('terminal', {
    command: 'printf ready; exec sleep 5', background: true
  }))
  assert.equal(start.background, true)
  assert.ok(start.session_id)
  await new Promise(resolve => setTimeout(resolve, 50))
  const poll = JSON.parse(await registry.execute('process_manage', {
    action: 'poll', session_id: start.session_id
  }))
  assert.equal(poll.session_id, start.session_id)
  assert.match(poll.output, /ready/)
  const killed = JSON.parse(await registry.execute('process_manage', {
    action: 'kill', session_id: start.session_id
  }))
  assert.equal(killed.success, true)
  const final = JSON.parse(await registry.execute('process_manage', {
    action: 'wait', session_id: start.session_id, timeout: 3
  }))
  assert.equal(final.running, false)
})

test('background process notify emits exit state through terminal output callback', async () => {
  setup()
  const notifications = []
  const started = JSON.parse(await registry.execute('terminal', { command: 'printf done', background: true, notify: true }, {
    sessionId: 'notify-session', onTerminalOutput: (stream, chunk) => notifications.push({ stream, chunk })
  }))
  const finished = JSON.parse(await registry.execute('process_manage', { action: 'wait', session_id: started.session_id, timeout: 3 }, { sessionId: 'notify-session' }))
  assert.equal(finished.running, false)
  assert.equal(notifications.length, 1)
  assert.match(notifications[0].chunk, new RegExp(started.session_id))
  assert.match(notifications[0].chunk, /exit code 0/)
})

test('background process sessions cannot be inspected or controlled across sessions', async () => {
  setup()
  const started = JSON.parse(await registry.execute('terminal', { command: 'exec sleep 5', background: true }, { sessionId: 'owner-a' }))
  const listed = JSON.parse(await registry.execute('process_manage', { action: 'list' }, { sessionId: 'owner-b' }))
  assert.equal(listed.processes.length, 0)
  const poll = JSON.parse(await registry.execute('process_manage', { action: 'poll', session_id: started.session_id }, { sessionId: 'owner-b' }))
  assert.ok(poll.error)
  const killed = JSON.parse(await registry.execute('process_manage', { action: 'kill', session_id: started.session_id }, { sessionId: 'owner-a' }))
  assert.equal(killed.success, true)
})

test('terminal background rejects empty commands and process manager rejects unknown ids', async () => {
  setup()
  const empty = JSON.parse(await registry.execute('terminal', { command: ' ', background: true }))
  assert.ok(empty.error)
  const unknown = JSON.parse(await registry.execute('process_manage', {
    action: 'poll', session_id: 'missing-session'
  }))
  assert.ok(unknown.error)
})
