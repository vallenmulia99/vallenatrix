import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillLoader } from '../dist/skills.js'

test('duplicate skills produce one summary warning, not one warning per file', () => {
  const root = mkdtempSync(join(tmpdir(), 'skill-dedup-'))
  const warnings = []
  const originalWarn = console.warn
  try {
    for (const subdir of ['first', 'second', 'third']) {
      const dir = join(root, subdir)
      mkdirSync(dir)
      writeFileSync(join(dir, 'SKILL.md'), `---\nname: shared-skill\ndescription: test\n---\nbody\n`)
    }
    console.warn = (...args) => warnings.push(args.join(' '))
    const loader = new SkillLoader([root])
    loader.load()
    assert.equal(loader.get('shared-skill')?.name, 'shared-skill')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /2 duplicate entries across 1 skill names/)
  } finally {
    console.warn = originalWarn
    rmSync(root, { recursive: true, force: true })
  }
})
