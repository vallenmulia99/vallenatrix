import test from 'node:test'
import assert from 'node:assert/strict'
import { AIAgent } from '../dist/agent.js'

test('Conversation History & Multi-turn context preservation', async (t) => {
  const agent = new AIAgent()
  assert.equal(typeof agent.resetSession, 'function')

  const secretCode = 'CODE_' + Math.random().toString(36).slice(2, 8).toUpperCase()

  // Initial state
  agent.resetSession()

  // First mock message
  const r1 = await agent.chat(`Hanya ingat di percakapan sesi ini (jangan gunakan tool memory/file): ${secretCode}. Balas dengan: KODE_DISIMPAN`)
  assert.ok(r1.response.includes('KODE_DISIMPAN'))

  // Second message asking for the secret code
  const r2 = await agent.chat('Sebutkan kembali kode rahasia tadi!')
  assert.ok(r2.response.includes(secretCode), 'Agent should remember secret code from previous turn')

  // Reset session
  agent.resetSession()
  const r3 = await agent.chat('Hanya dari ingatan percakapan sesi ini (tanpa mencari file atau memori), sebutkan kembali kode rahasia tadi!')
  assert.equal(r3.response.includes(secretCode), false, 'After reset, agent should NOT remember secret code')
})
