import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../dist/memory.js'

test('M8 serializes concurrent memory read-modify-write operations', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'm8-memory-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const a = new MemoryStore(dir), b = new MemoryStore(dir)
  await Promise.all([a.add('memory', 'first'), b.add('memory', 'second')])
  const entries = readFileSync(join(dir, 'MEMORY.md'), 'utf8').split('\n§\n')
  assert.deepEqual(new Set(entries), new Set(['first', 'second']))
})

test('M8 batch rejects empty replacement and empty add instead of succeeding silently', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'm8-batch-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new MemoryStore(dir)
  await store.add('memory', 'existing')
  assert.match((await store.batch([{ action: 'replace', old_text: 'existing', content: '' }])).error, /content required for replace/i)
  assert.match((await store.batch([{ action: 'add', content: '' }])).error, /content required/i)
})
