import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { loadConfig } from '../dist/config.js'
import { MemoryStore } from '../dist/memory.js'
import { TodoStore } from '../dist/todo.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'
import { registry } from '../dist/tools.js'

test('agent loads configured VALLENATRIX_HOME skills', t => {
  const home = mkdtempSync(join(tmpdir(), 'p2-config-'))
  const previousHome = process.env.VALLENATRIX_HOME
  const previousInteractive = process.env.VALLENATRIX_INTERACTIVE
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    if (previousInteractive === undefined) delete process.env.VALLENATRIX_INTERACTIVE
    else process.env.VALLENATRIX_INTERACTIVE = previousInteractive
    rmSync(home, { recursive: true, force: true })
  })
  process.env.VALLENATRIX_HOME = home
  process.env.VALLENATRIX_INTERACTIVE = '0'
  const skillDir = join(home, 'skills', 'custom')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), ['---', 'name: custom-home-skill', 'description: test', '---', ''].join('\n'))
  const config = {
    providers: { active: 'test', test: { base_url: 'http://127.0.0.1:1/v1', api_key: '', model: 'test', enabled: true } },
    skills: { paths: [join(home, 'skills')] },
    gateway: { llm_compaction: false },
    terminal: { cwd: home }
  }
  const agent = new AIAgent({ config, lightweight: true })
  agent.skillLoader.load()
  assert.equal(agent.skillLoader.get('custom-home-skill')?.name, 'custom-home-skill')
  assert.equal(agent.skillLoader.list().length, 1)
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
