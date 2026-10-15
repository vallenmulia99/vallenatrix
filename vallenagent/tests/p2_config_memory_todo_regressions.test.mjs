import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../dist/config.js'
import { MemoryStore } from '../dist/memory.js'
import { TodoStore } from '../dist/todo.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'
import { registry } from '../dist/tools.js'

test('default skill path follows VALLENATRIX_HOME', t => {
  const home = mkdtempSync(join(tmpdir(), 'p2-config-'))
  t.after(() => { delete process.env.VALLENATRIX_HOME; rmSync(home, { recursive: true, force: true }) })
  process.env.VALLENATRIX_HOME = home
  assert.equal(loadConfig().skills.paths[0], join(home, 'skills'))
})

test('defaults use current cwd when loaded, not module-load cwd', t => {
  const cwd = process.cwd()
  const dir = mkdtempSync(join(tmpdir(), 'p2-cwd-'))
  t.after(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }) })
  process.chdir(dir)
  delete process.env.VALLENATRIX_HOME
  assert.equal(loadConfig().terminal.cwd, dir)
})

test('memory add deduplicates and text replace/remove reject ambiguous matches', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'p2-memory-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new MemoryStore(dir)
  await store.add('memory', 'duplicate')
  await store.add('memory', 'duplicate')
  await store.add('memory', 'duplicate')
  assert.equal(readFileSync(join(dir, 'MEMORY.md'), 'utf8').split('duplicate').length - 1, 1)
  writeFileSync(join(dir, 'MEMORY.md'), ['duplicate A', 'duplicate B'].join('\n§\n'))
  assert.match((await store.replace('memory', 'duplicate', 'updated')).error, /multiple|ambiguous/i)
  assert.equal(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), 'duplicate A\n§\nduplicate B')
  assert.match((await store.remove('memory', 'duplicate')).error, /multiple|ambiguous/i)
  assert.equal(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), 'duplicate A\n§\nduplicate B')
})

test('memory replace rejects empty replacement content', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'p2-memory-empty-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new MemoryStore(dir)
  await store.add('memory', 'keep')
  assert.match((await store.replace('memory', 'keep', '  ')).error, /newContent must not be empty/)
})

test('cancelled todos are excluded from todo_list active_count', async () => {
  const todos = new TodoStore()
  registerBuiltinTools(undefined, undefined, todos, undefined, false, true)
  const result = JSON.parse(await registry.execute('todo_list', { todos: [
    { id: 'done', content: 'cancelled', status: 'cancelled' },
    { id: 'active', content: 'active', status: 'pending' }
  ] }))
  assert.equal(result.active_count, 1)
})
