import test from 'node:test'
import assert from 'node:assert/strict'
import { AIAgent } from '../dist/agent.js'

test('conversation history is isolated and reset between turns', async () => {
  const agent = new AIAgent()
  const seen = []
  agent.config.context_windows = { offline: 65_536 }
  agent.provider = {
    name: 'offline-test', baseURL: '', apiKey: '', model: 'offline',
    async chat(request) {
      seen.push(request.messages.map(({ role, content }) => ({ role, content })))
      return {
        id: 'offline', model: 'offline',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `reply-${seen.length}` } }]
      }
    }
  }
  agent.resetSession()
  const first = await agent.chat('first unique message')
  assert.equal(first.contextWindow, 65_536)
  await agent.chat('second message')
  assert.ok(seen[1].some((m) => m.role === 'user' && m.content === 'first unique message'))
  agent.resetSession()
  await agent.chat('after reset')
  assert.equal(seen[2].some((m) => m.role === 'user' && m.content === 'first unique message'), false)
})
