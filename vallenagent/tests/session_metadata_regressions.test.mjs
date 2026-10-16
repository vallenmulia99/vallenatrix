import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from '../dist/session.js'

test('session IDs that sanitize identically do not collide', t => {
  const dir = mkdtempSync(join(tmpdir(), 'session-id-collision-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const manager = new SessionManager(dir)
  manager.saveSession('a/b', [{ role: 'user', content: 'first' }])
  manager.saveSession('a_b', [{ role: 'user', content: 'second' }])
  assert.equal(manager.loadSession('a/b').messages[0].content, 'first')
  assert.equal(manager.loadSession('a_b').messages[0].content, 'second')
  assert.equal(manager.listSessions().length, 2)
})

test('session list uses small metadata and session history is compact JSON', t => {
  const dir = mkdtempSync(join(tmpdir(), 'session-meta-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const manager = new SessionManager(dir)
  manager.saveSession('meta-test', [{ role: 'user', content: 'Build a widget' }, { role: 'assistant', content: 'done' }])
  const files = readdirSync(dir)
  const sessionFile = files.find(name => name.endsWith('.json') && !name.endsWith('.meta.json'))
  const metaFile = files.find(name => name.endsWith('.meta.json'))
  assert.ok(sessionFile)
  assert.ok(metaFile)
  const raw = readFileSync(join(dir, sessionFile), 'utf8')
  assert.equal(raw.includes('\n'), false)
  assert.equal(JSON.parse(readFileSync(join(dir, metaFile), 'utf8')).title, 'Build a widget')
  assert.ok(manager.listSessions()[0].created_at)
  assert.ok(manager.listSessions()[0].updated_at)
  writeFileSync(join(dir, sessionFile), '{invalid history')
  assert.equal(manager.listSessions()[0].title, 'Build a widget')
})

test('legacy session listing reads metadata from prefix without parsing history', t => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-session-meta-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'old.json'), '{\n  "id": "legacy-id",\n  "title": "Legacy title",\n  "created_at": "2026-01-01T00:00:00.000Z",\n  "updated_at": "2026-01-02T00:00:00.000Z",\n  "cwd": "/repo",\n  "model": "model-x",\n  "messages": [THIS HISTORY IS NOT VALID JSON')
  assert.deepEqual(new SessionManager(dir).listSessions(), [{ id: 'legacy-id', title: 'Legacy title', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z', model: 'model-x' }])
})
