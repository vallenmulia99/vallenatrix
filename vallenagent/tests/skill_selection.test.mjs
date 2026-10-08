import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillLoader } from '../dist/skills.js'

test('skill matching uses tags and triggers before model call', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-match-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const webDir = join(base, 'creative', 'web-design')
  const dbDir = join(base, 'data', 'database')
  mkdirSync(webDir, { recursive: true })
  mkdirSync(dbDir, { recursive: true })
  writeFileSync(join(webDir, 'SKILL.md'), [
    '---', 'name: web-design', 'description: Design HTML pages.',
    'tags: [html, css, web-development]', 'triggers:', '  - landing page', '---',
    'Use responsive CSS and accessible HTML.'
  ].join('\n'))
  writeFileSync(join(dbDir, 'SKILL.md'), [
    '---', 'name: database', 'description: Database migrations.',
    'metadata:', '  hermes:', '    tags: [sql, database]', '---',
    'Use safe migrations.'
  ].join('\n'))

  const loader = new SkillLoader([base])
  loader.load()
  const selected = loader.getRelevantSkills('bikinin landing page HTML')
  assert.equal(selected[0]?.name, 'web-design')
  assert.equal(loader.getRelevantSkills('bikinin landing page HTML')[0].content, 'Use responsive CSS and accessible HTML.')
})
