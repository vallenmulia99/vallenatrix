import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { SkillLoader } from '../dist/skills.js'

test('system prompt asks model to batch independent discovery and avoid redundant tool calls', async t => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-efficient-guidance-'))
  const previousHome = process.env.VALLENATRIX_HOME
  process.env.VALLENATRIX_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  const agent = new AIAgent({ isSubagent: true })
  agent.skillLoader = new SkillLoader([])
  let systemPrompt = ''
  agent.provider.chat = async ({ messages }) => {
    systemPrompt = messages[0].content
    return { choices: [{ message: { content: 'done' } }] }
  }
  await agent.chat('check repo efficiently')
  assert.match(systemPrompt, /Batch independent read-only calls in one model response/i)
  assert.match(systemPrompt, /Do not repeat searches\/commands that already answered the question/i)
  assert.match(systemPrompt, /Load only the strongest matching skill\(s\)/i)
})
