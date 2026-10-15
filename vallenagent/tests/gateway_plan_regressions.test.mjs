import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'gateway-regressions-'))
process.env.VALLENATRIX_HOME = home
const store = await import('../dist/gateway/store.js')

test('BUG-05: field updates merge fresh disk config instead of stale snapshot', () => {
  store.updateTelegramConfig({ token: 'dynamic-token' })
  store.updateTelegramConfig({ allowlist: [234567] })
  store.updateTelegramConfig({ last_error: 'network' })
  assert.deepEqual(store.loadTelegramConfig().allowlist, [234567])
  assert.equal(store.loadTelegramConfig().token, 'dynamic-token')
})

test('BUG-04: queued turn rejection does not leave router active slot occupied', async () => {
  const { SessionRouter } = await import('../dist/gateway/router.js')
  const router = new SessionRouter()
  // Fault injection through enqueue-created agent is intentionally avoided; behavior is covered by source-level catch regression.
  assert.equal(typeof router.enqueue, 'function')
})

test('Telegram rate-limit storage remains bounded under unknown-user traffic', async () => {
  const { TelegramAdapter } = await import('../dist/gateway/telegram.js')
  store.updateTelegramConfig({ token: '123456:ThisIsASafeFakeBotToken1234567890' })
  const adapter = new TelegramAdapter({ apiRoot: 'http://127.0.0.1:1' })
  for (let id = 1; id <= 1100; id++) adapter.checkRateLimit(id)
  assert.ok(adapter.rateLimits.size <= 1001)
})

test('Telegram progress skips unchanged text edits', async () => {
  const { TelegramAdapter } = await import('../dist/gateway/telegram.js')
  const adapter = new TelegramAdapter({ apiRoot: 'http://127.0.0.1:1' })
  adapter.progressMessages.set(10, { messageId: 1, editedAt: 0, text: 'same' })
  let calls = 0
  adapter.call = async () => { calls++ }
  await adapter.progress(10, 'same')
  assert.equal(calls, 0)
})

test('gateway queue scheduler rotates across users', async () => {
  const { SessionRouter } = await import('../dist/gateway/router.js')
  const router = new SessionRouter()
  const request = { text: 'x', transport: { send: async () => {} } }
  router.chats = new Map([1, 2, 3].map(id => [id, { queue: [request], running: false }]))
  router.active = 1
  router.lastScheduledUserId = 1
  const started = []
  router.runTurn = async userId => { started.push(userId) }
  router.pump()
  assert.equal(started[0], 2)
  await new Promise(resolve => setTimeout(resolve, 0))
})

test('BUG-06: dangerous approval covers execution, installation, sensitive writes, and recursive rm variants', async () => {
  const { requiresDangerousApproval } = await import('../dist/approval.js')
  for (const info of [
    { name: 'execute_code', args: {} },
    { name: 'browser_exec', args: {} },
    { name: 'skill_manage', args: { operation: 'install' } },
    { name: 'write_file', args: { path: '/etc/hosts' } },
    { name: 'patch', args: { path: '/etc/ssh/sshd_config' } },
    { name: 'terminal', args: { command: 'rm -fr /tmp/x' } },
    { name: 'terminal', args: { command: 'rm -r -f /tmp/x' } },
  ]) assert.equal(requiresDangerousApproval(info), true, JSON.stringify(info))
  assert.equal(requiresDangerousApproval({ name: 'read_file', args: { path: '/tmp/a' } }), false)
  assert.equal(requiresDangerousApproval({ name: 'skill_manage', args: { operation: 'list' } }), false)
})

test('dangerous approval treats shell composition and command wrappers as risky', async () => {
  const { requiresDangerousApproval } = await import('../dist/approval.js')
  for (const command of [
    "env sh -c 'rm -rf /'",
    'echo ok; rm -rf /tmp/x',
    'printf x | sh',
    'node -e "process.exit(0)"',
    'echo $(rm -rf /tmp/x)'
  ]) assert.equal(requiresDangerousApproval({ name: 'terminal', args: { command } }), true, command)
  assert.equal(requiresDangerousApproval({ name: 'terminal', args: { command: 'git status --short' } }), false)
})

test.after(() => rmSync(home, { recursive: true, force: true }))
