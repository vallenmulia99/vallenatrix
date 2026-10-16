import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from '../dist/session.js'

test('clearAllSessions deletes every saved session pair and reports session count', t => {
  const dir = mkdtempSync(join(tmpdir(), 'session-clear-all-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const manager = new SessionManager(dir)
  manager.saveSession('one', [{ role: 'user', content: 'first session' }])
  manager.saveSession('two', [{ role: 'user', content: 'second session' }])
  assert.equal(manager.clearAllSessions(), 2)
  assert.equal(manager.listSessions().length, 0)
  assert.deepEqual(readdirSync(dir), [])
})

test('clearAllSessions safely handles empty session directory', t => {
  const dir = mkdtempSync(join(tmpdir(), 'session-clear-empty-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const manager = new SessionManager(dir)
  assert.equal(manager.clearAllSessions(), 0)
  assert.deepEqual(readdirSync(dir), [])
})
