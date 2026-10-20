import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AIAgent } from '../dist/agent.js'
import { SkillLoader } from '../dist/skills.js'

test('Agent Reach skill routes YouTube requests and exposes video reference', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.vallenatrix', 'skills')
  const loader = new SkillLoader([root])
  loader.load()
  const skill = loader.get('agent-reach')
  assert.ok(skill, 'Agent Reach skill is loadable')
  assert.ok(loader.getRelevantSkills('summarize this YouTube video').some(s => s.metadata.name === 'agent-reach'))
  assert.ok(skill.linkedFiles.references.includes('video.md'))
  assert.ok(existsSync(join(root, 'agent-reach', 'references', 'video.md')))
})

test('agent loads user-installed skills directory even when config has no skill paths', async t => {
  const previousHome = process.env.VALLENATRIX_HOME
  process.env.VALLENATRIX_HOME = join(homedir(), '.vallenatrix')
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
  })
  const bundledRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.vallenatrix', 'skills')
  const agent = new AIAgent({
    isSubagent: true,
    config: {
      providers: { active: 'test', test: { base_url: 'http://127.0.0.1:1/v1', api_key: '', model: 'test', enabled: true } },
      skills: { paths: [join(homedir(), '.vallenatrix', 'skills'), bundledRoot] }
    }
  })
  assert.ok(agent.skillLoader.get('agent-reach'), 'bundled Agent Reach skill is visible')
})
