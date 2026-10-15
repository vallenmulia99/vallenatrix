import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tokenize, searchSessions, formatHits } from '../dist/session_search.js'

function makeSession(dir, name, messages) {
  const file = join(dir, `${name}.json`)
  writeFileSync(file, JSON.stringify({ id: name, title: name, messages }, null, 2))
  return file
}

test('session_search: tokenize drops stopwords and short tokens', () => {
  assert.deepEqual(tokenize('perbaiki bug yang ada di approval.ts'), ['perbaiki', 'bug', 'approval.ts'])
  assert.deepEqual(tokenize('the and for'), [])
  assert.deepEqual(tokenize(''), [])
})

test('session_search: ranks sessions by user-weighted matches and returns snippets', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-sessions-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  makeSession(dir, 'hit-user', [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'tolong perbaiki bug approval di terminal tool' },
    { role: 'assistant', content: 'baik, saya periksa approval.ts' }
  ])
  makeSession(dir, 'hit-agent-only', [
    { role: 'assistant', content: 'approval sudah saya jelaskan di atas' }
  ])
  makeSession(dir, 'no-hit', [
    { role: 'user', content: 'buatkan wallpaper baru untuk terminal' }
  ])

  const hits = searchSessions('bug approval', { dirs: [dir] })
  assert.equal(hits.length, 2)
  assert.equal(hits[0].sessionId, 'hit-user', 'user-role match must outrank assistant-only')
  assert.ok(hits[0].score > hits[1].score)
  assert.match(hits[0].snippet, /approval/)
  assert.ok(hits[0].matchedTerms.includes('approval'))

  const none = searchSessions('zzz-tidak-ada', { dirs: [dir] })
  assert.equal(none.length, 0)
  assert.match(formatHits(none), /Tidak ada sesi lama/)
})

test('session_search: respects limit and tolerates corrupt files', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-sessions-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  for (let i = 0; i < 5; i++) {
    makeSession(dir, `s${i}`, [{ role: 'user', content: `touchdown marker ${i}` }])
  }
  writeFileSync(join(dir, 'broken.json'), '{not json')

  const hits = searchSessions('touchdown', { dirs: [dir], limit: 2 })
  assert.equal(hits.length, 2)
  assert.ok(hits.every(hit => hit.score > 0))

  const top = searchSessions('touchdown', { dirs: [dir], limit: 1 })
  assert.equal(top.length, 1)
})

test('session_search: empty query returns nothing, never throws', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-sessions-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(searchSessions('', { dirs: [dir] }), [])
  assert.deepEqual(searchSessions('the and', { dirs: [dir] }), [])
  assert.deepEqual(searchSessions('apa saja', { dirs: ['/nonexistent-dir-xyz'] }), [])
})
