import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../dist/memory.js'

test('ambiguous replace and remove refuse to mutate any entry', async t => {
  const root = mkdtempSync(join(tmpdir(), 'memory-ambiguous-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = new MemoryStore(root)
  await store.add('memory', 'Uses blue terminal theme.')
  await store.add('memory', 'Uses blue editor theme.')
  const file = join(root, 'MEMORY.md')
  const before = readFileSync(file, 'utf8')
  assert.match((await store.replace('memory', 'blue', 'Uses red theme.')).error, /multiple|ambiguous/i)
  assert.match((await store.remove('memory', 'blue')).error, /multiple|ambiguous/i)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('ambiguous batch operation aborts atomically and add deduplicates normalized content', async t => {
  const root = mkdtempSync(join(tmpdir(), 'memory-batch-ambiguous-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = new MemoryStore(root)
  await store.add('memory', 'Uses blue terminal theme.')
  await store.add('memory', 'Uses blue editor theme.')
  const file = join(root, 'MEMORY.md')
  const before = readFileSync(file, 'utf8')
  assert.match((await store.batch([
    { action: 'add', content: 'another fact' },
    { action: 'replace', old_text: 'blue', new_text: 'red' }
  ])).error, /multiple|ambiguous/i)
  assert.equal(readFileSync(file, 'utf8'), before)
  await store.add('memory', '  Uses   BLUE terminal theme.  ')
  assert.equal(store.formatForSystemPrompt().match(/Uses blue terminal theme\./gi)?.length, 1)
})
