import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Platform } from '../dist/platforms/session_context.js'
import { SessionStore } from '../dist/platforms/session_store.js'

test('gateway session metadata stays private', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vallenatrix-gateway-perms-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new SessionStore(dir)
  store.getOrCreateSession({
    platform: Platform.WHATSAPP, chatId: 'private-chat', chatType: 'dm', userId: 'private-user'
  }, [Platform.CLI], new Map())

  assert.equal(statSync(dir).mode & 0o777, 0o700)
  assert.equal(statSync(join(dir, 'sessions.json')).mode & 0o777, 0o600)
})
