import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { MemoryStore } from '../dist/memory.js'
import { TodoStore } from '../dist/todo.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

test('skill_manage blocks create traversal', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-path-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const skillsDir = join(base, 'skills')
  mkdirSync(skillsDir)
  const loader = new SkillLoader([skillsDir])
  loader.load()
  registerBuiltinTools(loader, new MemoryStore(join(base, 'memory')), new TodoStore(), async () => '', false)

  const result = JSON.parse(await registry.execute('skill_manage', {
    operations: [{ action: 'create', category: '../escaped', name: 'bad', content: 'pwned' }]
  }))
  assert.ok(result.error)
  assert.equal(existsSync(join(base, 'escaped', 'bad', 'SKILL.md')), false)
})

test('skill_view blocks arbitrary and symlinked linked-file reads', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-view-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const skillDir = join(base, 'skills', 'demo')
  const referencesDir = join(skillDir, 'references')
  mkdirSync(referencesDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), ['---', 'name: demo', 'description: Demo', '---', ''].join('\n'))
  writeFileSync(join(base, 'outside.md'), 'outside')
  symlinkSync(join(base, 'outside.md'), join(referencesDir, 'outside.md'))
  const loader = new SkillLoader([join(base, 'skills')])
  loader.load()
  registerBuiltinTools(loader, new MemoryStore(join(base, 'memory')), new TodoStore(), async () => '', false)

  const traversal = JSON.parse(await registry.execute('skill_view', { name: 'demo', file_path: '../../outside.md' }))
  const symlink = JSON.parse(await registry.execute('skill_view', { name: 'demo', file_path: 'references/outside.md' }))
  assert.ok(traversal.error)
  assert.ok(symlink.error)
})

test('skill_manage blocks linked file traversal', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-path-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const skillDir = join(base, 'skills', 'demo')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: Demo\n---\n')
  const loader = new SkillLoader([join(base, 'skills')])
  loader.load()
  registerBuiltinTools(loader, new MemoryStore(join(base, 'memory')), new TodoStore(), async () => '', false)

  const result = JSON.parse(await registry.execute('skill_manage', {
    operations: [{ action: 'write_file', name: 'demo', file_path: '../../escaped.txt', content: 'pwned' }]
  }))
  assert.ok(result.error)
  assert.equal(existsSync(join(base, 'escaped.txt')), false)
})

test('skill_manage delete does not remove skills root', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-skill-delete-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const skillsDir = join(base, 'skills')
  mkdirSync(skillsDir)
  writeFileSync(join(skillsDir, 'SKILL.md'), '---\nname: root\ndescription: root\n---\n')
  const loader = new SkillLoader([skillsDir])
  loader.load()
  registerBuiltinTools(loader, new MemoryStore(join(base, 'memory')), new TodoStore(), async () => '', false)
  const result = JSON.parse(await registry.execute('skill_manage', { operations: [{ action: 'delete', name: 'root' }] }))
  assert.ok(result.error)
  assert.equal(existsSync(skillsDir), true)
})
