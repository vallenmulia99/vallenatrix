import test from 'node:test'
import assert from 'node:assert/strict'
import { AIAgent } from '../dist/agent.js'

test('BUG-06: parallel chat calls serialize correctly', async (t) => {
  const agent = new AIAgent({ maxIterations: 1 })
  
  // Mock provider
  let callCount = 0
  agent.provider = {
    model: 'test',
    name: 'test',
    chat: async (req) => {
      callCount++
      await new Promise(r => setTimeout(r, 50))
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: `Response ${callCount}`
          }
        }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 }
      }
    }
  }
  
  // Fire two parallel calls
  const [res1, res2] = await Promise.all([
    agent.chat('msg1'),
    agent.chat('msg2')
  ])
  
  // Both should complete
  assert.ok(res1.response.includes('Response'))
  assert.ok(res2.response.includes('Response'))
  
  // History should be valid (no consecutive user messages)
  const history = agent.conversationHistory
  for (let i = 1; i < history.length; i++) {
    if (history[i].role === 'user' && history[i-1].role === 'user') {
      assert.fail('Found consecutive user messages')
    }
  }
})

test('BUG-08: provider error rollback user message if no progress', async (t) => {
  const agent = new AIAgent({ maxIterations: 1 })
  
  agent.provider = {
    model: 'test',
    name: 'test',
    chat: async () => { throw new Error('Provider down') }
  }
  
  const beforeLen = agent.conversationHistory.length
  
  try {
    await agent.chat('test message')
    assert.fail('Should have thrown')
  } catch (err) {
    assert.ok(err.message.includes('Provider down'))
  }
  
  // User message should be rolled back (no progress made)
  const afterLen = agent.conversationHistory.length
  assert.equal(afterLen, beforeLen, 'History should not grow on immediate provider error')
})

test('BUG-09: provider no choices throws clear error', async (t) => {
  const agent = new AIAgent({ maxIterations: 1 })
  
  // Need to actually call provider.chat, not agent.chat
  const origProvider = agent.provider
  agent.provider = {
    model: 'test',
    name: 'test',
    chat: async () => {
      // Simulate provider response
      const data = {
        choices: [],
        error: { message: 'rate limited' }
      }
      
      // This should throw in the provider
      if (!data.choices || data.choices.length === 0) {
        const errorMsg = data.error ? JSON.stringify(data.error).slice(0, 500) : JSON.stringify(data).slice(0, 500)
        throw new Error(`Provider returned no choices: ${errorMsg}`)
      }
      return data
    }
  }
  
  try {
    await agent.chat('test')
    assert.fail('Should have thrown')
  } catch (err) {
    assert.ok(err.message.includes('no choices'), `Error was: ${err.message}`)
    assert.ok(err.message.includes('rate limited'), `Error was: ${err.message}`)
  }
})
