import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { escapeHtml, redact, splitMessage, stripAnsi } from '../dist/gateway/format.js'
import { createTelegramPairingCode } from '../dist/gateway/manager.js'
import { loadTelegramConfig, saveTelegramConfig, telegramConfigPath, writeTelegramOffsetBeforeHandling } from '../dist/gateway/store.js'
import { handleCommand } from '../dist/commands.js'
import { TelegramAdapter } from '../dist/gateway/telegram.js'
import { createMockTelegramServer } from './helpers/mock_telegram_server.mjs'

function isolatedHome(t) {
  const previous = process.env.VALLENATRIX_HOME
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-gateway-test-'))
  process.env.VALLENATRIX_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previous
    rmSync(home, { recursive: true, force: true })
  })
  return home
}

test('gateway state uses private directory/file modes and persists offsets before handling', t => {
  isolatedHome(t)
  const config = loadTelegramConfig()
  config.token = '123456:ThisIsASafeFakeBotToken1234567890'
  saveTelegramConfig(config)
  writeTelegramOffsetBeforeHandling(41)
  assert.equal(loadTelegramConfig().last_update_id, 42)
  assert.equal(statSync(telegramConfigPath()).mode & 0o777, 0o600)
})

test('pairing codes are six digits, single state, and short lived', t => {
  isolatedHome(t)
  const code = createTelegramPairingCode(1000)
  const config = loadTelegramConfig()
  assert.match(code, /^\d{6}$/)
  // Only the hash is persisted, so the file never carries the live code.
  assert.equal(config.pairing.code_hash, createHash('sha256').update(code).digest('hex'))
  assert.equal(config.pairing.code, undefined)
  assert.equal(config.pairing.expires_at, 301000)
  assert.equal(config.pairing.attempts, 0)
})

test('splitMessage respects the Telegram limit, preserves all text, and keeps emoji intact', () => {
  const input = ('baris 🐈 kata\n').repeat(900)
  const chunks = splitMessage(input, 4000)
  assert.ok(chunks.every(chunk => chunk.length <= 4000))
  assert.equal(chunks.join(''), input)
  for (const chunk of chunks) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk))
    assert.ok(!/^[\uDC00-\uDFFF]/.test(chunk))
  }
})

test('gateway formatting strips ANSI, escapes HTML, and redacts bot API tokens', () => {
  assert.equal(stripAnsi('\u001b[31mmerah\u001b[0m'), 'merah')
  assert.equal(escapeHtml('<a&"'), '&lt;a&amp;&quot;')
  assert.equal(redact('https://api.telegram.org/bot12345:Abc_def-123/getUpdates'), 'https://api.telegram.org/bot***/getUpdates')
})

test('terminal-only commands are rejected on remote channel', async () => {
  for (const command of ['/token abc123', '/geteway tel status']) {
    const result = await handleCommand({ channel: 'remote', agent: {} }, command)
    assert.equal(result.handled, true)
    assert.match(result.response, /hanya bisa digunakan dari terminal/i)
  }
})

test('Telegram adapter ignores non-allowlisted users and groups, then consumes one-time pairing', async t => {
  isolatedHome(t)
  const state = loadTelegramConfig()
  state.token = '123456:ThisIsASafeFakeBotToken1234567890'
  state.pairing = { code_hash: createHash('sha256').update('123456').digest('hex'), expires_at: Date.now() + 60_000, attempts: 0 }
  saveTelegramConfig(state)
  const mock = await createMockTelegramServer()
  const enqueued = []
  const adapter = new TelegramAdapter({ apiRoot: mock.apiRoot, router: { enqueue: (...args) => { enqueued.push(args); return true } } })
  t.after(async () => { await adapter.stop(); await mock.close() })
  await adapter.start()
  const update = (update_id, userId, chatId, type, text) => ({
    update_id, message: { from: { id: userId }, chat: { id: chatId, type }, text }
  })
  mock.push(update(1, 222, 222, 'private', 'hello'))
  mock.push(update(2, 222, -100, 'group', 'hello'))
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal(enqueued.length, 0)
  assert.equal(mock.calls.filter(call => call.method === 'sendMessage').length, 0)

  mock.push(update(3, 222, 222, 'private', '/pair 123456'))
  for (let attempt = 0; attempt < 30 && (!loadTelegramConfig().allowlist.includes(222) || mock.calls.filter(call => call.method === 'sendMessage').length !== 1); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.deepEqual(loadTelegramConfig().allowlist, [222])
  assert.equal(loadTelegramConfig().pairing, undefined)
  assert.equal(mock.calls.filter(call => call.method === 'sendMessage').length, 1)
})
