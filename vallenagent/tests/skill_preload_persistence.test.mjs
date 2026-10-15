import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'

test('matched skill stays active for follow-up turns and clears on reset', async t => {
  const home = mkdtempSync(join(tmpdir(), 'skill-persist-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const agent = new AIAgent({ isSubagent: true, maxIterations: 2 })
  const marker = 'PERSISTENT_SKILL_MARKER'
  agent.skillLoader = { getFormattedIndex: () => '', getRelevantSkills: message => message.includes('use-skill') ? [{ name: 'test-skill', content: marker }] : [] }
  const captured = []
  agent.provider.chat = async ({ messages }) => { captured.push(messages); return { choices: [{ message: { content: 'done' } }] } }
  await agent.chat('use-skill')
  await agent.chat('continue')
  assert.equal(captured[1].filter(message => message.role === 'user' && message.content.includes(marker)).length, 1)
  agent.resetSession()
  await agent.chat('continue')
  assert.equal(captured[2].some(message => message.role === 'user' && message.content.includes(marker)), false)
})
