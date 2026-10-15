import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchOfficialSkill } from '../dist/skills_hub_search.js'

test('official skills fetch uses configured skills root and rejects traversal', async t => {
  const root = mkdtempSync(join(tmpdir(), 'vallenatrix-c10-'))
  const skill = join(root, 'tools', 'sample')
  mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: sample description\n---\nbody')
  const previous = process.env.VALLENATRIX_BUNDLED_SKILLS
  process.env.VALLENATRIX_BUNDLED_SKILLS = root
  t.after(() => {
    if (previous === undefined) delete process.env.VALLENATRIX_BUNDLED_SKILLS
    else process.env.VALLENATRIX_BUNDLED_SKILLS = previous
    rmSync(root, { recursive: true, force: true })
  })
  assert.equal((await fetchOfficialSkill('tools', 'sample')).name, 'sample')
  await assert.rejects(fetchOfficialSkill('../outside', 'secret'), /Invalid official skill identifier/)
})