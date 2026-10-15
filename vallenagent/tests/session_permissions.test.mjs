import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, chmodSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from '../dist/session.js'
import { MemoryStore } from '../dist/memory.js'

test('session directory and files are private', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-session-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const sessionDir = join(base, 'sessions')
  mkdirSync(sessionDir)
  writeFileSync(join(sessionDir, 'old.json'), '{}')
  chmodSync(sessionDir, 0o755)
  chmodSync(join(sessionDir, 'old.json'), 0o664)
  const sessions = new SessionManager(sessionDir)
  sessions.saveSession('test-session', [{ role: 'user', content: 'private' }], base, 'model')
  assert.equal(statSync(sessionDir).mode & 0o777, 0o700)
  assert.equal(statSync(join(sessionDir, 'old.json')).mode & 0o777, 0o600)
  const sessionFile = readdirSync(sessionDir).find(name => name.startsWith('test-session-') && name.endsWith('.json') && !name.endsWith('.meta.json'))
  const metadataFile = readdirSync(sessionDir).find(name => name.startsWith('test-session-') && name.endsWith('.meta.json'))
  assert.ok(sessionFile)
  assert.ok(metadataFile)
  assert.equal(statSync(join(sessionDir, sessionFile)).mode & 0o777, 0o600)
  assert.equal(statSync(join(sessionDir, metadataFile)).mode & 0o777, 0o600)
})

test('session title remains based on original user message after later saves', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-session-title-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const sessions = new SessionManager(base)
  sessions.saveSession('title-test', [{ role: 'user', content: 'Build durable title' }], base, 'model')
  sessions.saveSession('title-test', [
    { role: 'user', content: '[Previous conversation summary]' },
    { role: 'user', content: '/plan boilerplate' }
  ], base, 'model')
  assert.equal(sessions.loadSession('title-test')?.title, 'Build durable title')
})

test('memory directory and files are private', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'vallenatrix-memory-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const memories = new MemoryStore(join(base, 'memories'))
  await memories.add('memory', 'private note')
  assert.equal(statSync(join(base, 'memories')).mode & 0o777, 0o700)
  assert.equal(statSync(join(base, 'memories', 'MEMORY.md')).mode & 0o777, 0o600)
})
