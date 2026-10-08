import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { GatewayRunner } from '../dist/platforms/gateway_runner.js'

test('gateway keeps WhatsApp agent history isolated per chat and reset', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-gateway-'))
  const previousHome = process.env.VALLENATRIX_HOME
  process.env.VALLENATRIX_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  const templateAgent = new AIAgent({ isSubagent: true })
  const runner = new GatewayRunner({
    gateway: {},
    agentInstance: templateAgent,
    dataDir: join(home, 'gateway')
  })
  runner.gateway.sendWhatsApp = async () => {}
  const agentsUsed = []
  const originalChat = AIAgent.prototype.chat
  AIAgent.prototype.chat = async function () {
    agentsUsed.push(this)
    return { response: 'ok', iterations: 1, totalTokens: 0 }
  }
  t.after(() => { AIAgent.prototype.chat = originalChat })

  const send = (chatId, text = 'hello') => runner.handleMessage({
    platform: 'whatsapp', chatId, senderId: chatId, senderName: chatId,
    text, timestamp: Date.now(), isGroup: false
  })

  await send('chat-a')
  await send('chat-b')
  await send('chat-a', '/reset')
  await send('chat-a')
  await send('chat-b')

  assert.notEqual(agentsUsed[0], agentsUsed[1], 'different chats need different AIAgent instances')
  assert.notEqual(agentsUsed[0], agentsUsed[2], 'reset should start a fresh agent for that chat')
  assert.equal(agentsUsed[1], agentsUsed[3], 'other chat agent must survive reset')
})
