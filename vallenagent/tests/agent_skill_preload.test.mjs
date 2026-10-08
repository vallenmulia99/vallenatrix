import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { SkillLoader } from '../dist/skills.js'

test('agent loads matching skill and reports skill_view before first model call', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-agent-skill-'))
  const previousHome = process.env.VALLENATRIX_HOME
  process.env.VALLENATRIX_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  const skillDir = join(home, 'skills', 'creative', 'web-design')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), [
    '---', 'name: web-design', 'description: HTML page design.',
    'tags: [html, css, web-development]', 'triggers:', '  - landing page', '---',
    'Use responsive HTML and CSS.'
  ].join('\n'))

  const agent = new AIAgent({ isSubagent: true })
  agent.skillLoader = new SkillLoader([join(home, 'skills')])
  agent.skillLoader.load()
  const starts = []
  const ends = []
  let sentMessages
  agent.provider.chat = async ({ messages }) => {
    assert.equal(starts[0]?.name, 'skill_view')
    assert.equal(ends[0]?.name, 'skill_view')
    sentMessages = messages
    return { choices: [{ message: { content: 'done' } }] }
  }

  await agent.chat('bikinin landing page HTML', {
    onToolStart: event => { starts.push(event); throw new Error('status renderer unavailable') },
    onToolEnd: event => { ends.push(event); throw new Error('status renderer unavailable') }
  })

  assert.equal(starts.length, 1)
  assert.equal(starts[0].args.name, 'web-design')
  assert.match(starts[0].preview, /preparing skill_view/)
  assert.match(ends[0].preview, /skill\s+web-design/)
  assert.match(sentMessages.find(message => message.role === 'user').content, /Use responsive HTML and CSS/)
})
