import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'

test('interrupt before first provider call persists current conversation', async t => {
  const home = mkdtempSync(join(tmpdir(), 'interrupt-session-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const agent = new AIAgent({ maxIterations: 2 })
  agent.skillLoader = { getFormattedIndex: () => '', getRelevantSkills: () => { agent.interrupt(); return [] } }
  const result = await agent.chat('preserve this interrupted task')
  assert.match(result.response, /Execution halted/)
  const session = agent.sessionManager.loadSession(agent.getSessionId())
  assert.ok(session)
  assert.ok(session.messages.some(message => message.role === 'user' && message.content.includes('preserve this interrupted task')))
})
