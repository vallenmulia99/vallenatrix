import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillLoader } from '../dist/skills.js'

function writeSkill(root, category, name, description) {
  const dir = category ? join(root, category, name) : join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody text that must not appear in the index.\n`)
}

test('skills index: caps descriptions and compacts the uncategorised bucket', t => {
  const root = mkdtempSync(join(tmpdir(), 'vallen-skills-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const longDesc = 'A'.repeat(300)
  writeSkill(root, 'creative', 'short-one', 'Short and useful.')
  writeSkill(root, 'creative', 'long-one', longDesc)
  // Flat profile-style skills (no category folder) land in 'general'.
  writeSkill(root, null, 'flat-one', 'Flat skill one.')
  writeSkill(root, null, 'flat-two', 'Flat skill two.')

  const loader = new SkillLoader([root])
  loader.load()
  const index = loader.getFormattedIndex()

  assert.match(index, /- short-one: Short and useful\./)
  assert.doesNotMatch(index, new RegExp(`A{${200}}`), 'long description must be truncated')
  assert.match(index, /long-one: A+…/)
  assert.match(index, /general \(2\): flat-one, flat-two/)
  assert.doesNotMatch(index, /flat-one: Flat skill one/, 'general bucket drops per-skill descriptions')
  assert.doesNotMatch(index, /Body text that must not appear/, 'bodies stay out of the index')
})

test('skills index: descriptionChars=0 emits names only', t => {
  const root = mkdtempSync(join(tmpdir(), 'vallen-skills-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeSkill(root, 'creative', 'solo', 'Some description here.')

  const loader = new SkillLoader([root])
  loader.load()
  const index = loader.getFormattedIndex({ descriptionChars: 0 })
  assert.match(index, /- solo\n/)
  assert.doesNotMatch(index, /Some description here/)
})

test('skills index: stays small for many flat skills', t => {
  const root = mkdtempSync(join(tmpdir(), 'vallen-skills-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (let i = 0; i < 40; i++) writeSkill(root, null, `flat-${i}`, 'B'.repeat(120))

  const loader = new SkillLoader([root])
  loader.load()
  const index = loader.getFormattedIndex()
  // 40 names + one header line beats 40 × 120 chars of descriptions by an order of magnitude.
  assert.ok(index.length < 2000, `index too big: ${index.length}`)
})
