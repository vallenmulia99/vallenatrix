import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'

test('skill preload is added only to current user message when text repeats', async t => {
  const home = mkdtempSync(join(tmpdir(), 'skill-preload-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const agent = new AIAgent({ isSubagent: true, maxIterations: 2 })
  const skillText = 'UNIQUE_SKILL_PRELOAD_MARKER'
  agent.skillLoader = { getRelevantSkills: () => [{ name: 'test-skill', content: skillText }] }
  agent.conversationHistory = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'continue' },
    { role: 'assistant', content: 'first response' },
    { role: 'user', content: 'continue' },
    { role: 'assistant', content: 'second response' }
  ]
  let captured
  agent.provider.chat = async ({ messages }) => { captured = messages; return { choices: [{ message: { content: 'done' } }] } }
  await agent.chat('continue')
  assert.equal(captured.filter(message => message.role === 'user' && message.content.includes(skillText)).length, 1)
})
