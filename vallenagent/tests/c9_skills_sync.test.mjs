import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncBundledSkills } from '../dist/skills_sync.js'

test('sync never overwrites existing skill absent from manifest', t => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-c9-'))
  const bundled = join(home, 'bundled')
  const user = join(home, 'user', 'skills', 'local')
  mkdirSync(join(bundled, 'local'), { recursive: true })
  mkdirSync(user, { recursive: true })
  writeFileSync(join(bundled, 'local', 'SKILL.md'), 'BUNDLED')
  writeFileSync(join(user, 'SKILL.md'), 'USER DATA')
  const oldHome = process.env.VALLENATRIX_HOME
  const oldBundled = process.env.VALLENATRIX_BUNDLED_SKILLS
  process.env.VALLENATRIX_HOME = join(home, 'user')
  process.env.VALLENATRIX_BUNDLED_SKILLS = bundled
  t.after(() => {
    if (oldHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = oldHome
    if (oldBundled === undefined) delete process.env.VALLENATRIX_BUNDLED_SKILLS
    else process.env.VALLENATRIX_BUNDLED_SKILLS = oldBundled
    rmSync(home, { recursive: true, force: true })
  })
  assert.deepEqual(syncBundledSkills().skipped, ['local'])
  assert.equal(readFileSync(join(user, 'SKILL.md'), 'utf8'), 'USER DATA')
})
