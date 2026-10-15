import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
    'tags: [html, css, web-development]', 'triggers:',
    '  - landing page', '---', 'Use responsive CSS and accessible HTML.'
  ].join('\n'))
  writeFileSync(join(dbDir, 'SKILL.md'), [
    '---', 'name: database', 'description: Database migrations.',
    'metadata:', '  hermes:', '    tags: [sql, database]', '---', 'Use safe migrations.'
  ].join('\n'))

  const loader = new SkillLoader([base])
  loader.load()
  const selected = loader.getRelevantSkills('bikinin landing page HTML')
  assert.equal(selected[0]?.name, 'web-design')
  assert.equal(loader.getRelevantSkills('need css help')[0]?.name, 'web-design')
  assert.equal(loader.getRelevantSkills('need sql help')[0]?.name, 'database')
  assert.equal(selected[0].content, 'Use responsive CSS and accessible HTML.')
})

test('skill ranking prefers exact trigger and phrase over a shared tag', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-rank-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  for (const [name, frontmatter] of [
    ['general', 'tags: [typescript]'],
    ['specific', 'triggers: ["debug this typescript error"]\ntags: [typescript]']
  ]) {
    const dir = join(base, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: TypeScript help.\n${frontmatter}\n---\nInstructions.`)
  }
  const loader = new SkillLoader([base])
  loader.load()
  assert.equal(loader.getRelevantSkills('please debug this typescript error')[0]?.name, 'specific')
})

test('skill ranking returns only relevant candidates and scores all matching tags', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-tags-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  for (const [name, tags] of [['one', 'typescript'], ['two', 'typescript, debugging'], ['other', 'python']]) {
    const dir = join(base, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Developer help.\ntags: [${tags}]\n---\nInstructions.`)
  }
  const loader = new SkillLoader([base])
  loader.load()
  assert.deepEqual(loader.getRelevantSkills('typescript debugging').map(skill => skill.name), ['two', 'one'])
})

 test('skill index lists linked files as relative file paths only', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-links-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const dir = join(base, 'linked')
  mkdirSync(join(dir, 'references', 'nested'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: linked\ndescription: Linked files.\n---\nInstructions.')
  writeFileSync(join(dir, 'references', 'guide.md'), 'Guide.')
  writeFileSync(join(dir, 'references', 'nested', 'deep.md'), 'Deep guide.')
  writeFileSync(join(dir, 'references', '.hidden.md'), 'Hidden.')
  const external = join(base, 'outside')
  mkdirSync(external)
  writeFileSync(join(external, 'secret.md'), 'Outside skill root.')
  symlinkSync(external, join(dir, 'scripts'), 'dir')
  const loader = new SkillLoader([base])
  loader.load()
  assert.deepEqual(loader.get('linked')?.linkedFiles?.references, ['guide.md', 'nested/deep.md'])
  assert.deepEqual(loader.get('linked')?.linkedFiles?.scripts, [])
})

 test('disabled skills remain disabled after reload and enabled allowlist remains effective', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-state-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  for (const name of ['one', 'two']) {
    const dir = join(base, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} tasks.\n---\nInstructions.`)
  }
  const loader = new SkillLoader([base], { enabled: ['one'] })
  loader.load()
  assert.deepEqual(loader.list().map(skill => skill.name), ['one'])
  assert.equal(loader.disable('one'), true)
  loader.reload()
  assert.deepEqual(loader.list(), [])
  assert.equal(loader.enable('one'), true)
  assert.deepEqual(loader.list().map(skill => skill.name), ['one'])
})

test('duplicate skill names resolve by sorted directory order', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-order-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  for (const [dir, body] of [['z-source', 'From z.'], ['a-source', 'From a.']]) {
    const skillDir = join(base, dir)
    mkdirSync(skillDir)
    writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: shared\ndescription: Shared skill\n---\n${body}`)
  }
  const loader = new SkillLoader([base])
  loader.load()
  assert.equal(loader.get('shared')?.content, 'From a.')
})

test('website does not spuriously match generic web QA and research tags', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-web-boundary-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  for (const [name, tags] of [['dogfood', 'web, qa, testing'], ['grounded-citations', 'web, research']]) {
    const dir = join(base, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} workflow.\ntags: [${tags}]\n---\nInstructions.`)
  }
  const loader = new SkillLoader([base])
  loader.load()
  assert.deepEqual(loader.getRelevantSkills('langsung buat ruang-kopi-website.md'), [])
})

test('website brief ranks interactive web skill above generic web-tag skills', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-web-rank-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  for (const [name, frontmatter] of [
    ['dogfood', 'description: Test web apps.\ntags: [web, qa]'],
    ['web-interaction-prototyping', 'description: Build interactive responsive websites.\ntags: [web, frontend, accessibility]\ntriggers: [website, interactive website, landing page]']
  ]) {
    const dir = join(base, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n${frontmatter}\n---\nUse semantic HTML and test interactions.`)
  }
  const loader = new SkillLoader([base])
  loader.load()
  assert.equal(loader.getRelevantSkills('langsung buat ruang-kopi-website.md')[0]?.name, 'web-interaction-prototyping')
})

test('skill matcher does not throw for plus signs in user text', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-regex-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const skillDir = join(base, 'compile')
  mkdirSync(skillDir)
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: compile\ndescription: C++ compiler support\n---\nCompile C++.')
  const loader = new SkillLoader([base])
  loader.load()
  assert.doesNotThrow(() => loader.getRelevantSkills('why does g++ compile fail'))
  assert.doesNotThrow(() => loader.getRelevantSkills('+++ b/src/app.ts'))
  assert.deepEqual(loader.getRelevantSkills('x'.repeat(100_000)), [])
})
