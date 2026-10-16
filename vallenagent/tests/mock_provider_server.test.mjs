import test from 'node:test'
import assert from 'node:assert/strict'
import { AIAgent } from '../dist/agent.js'
import { OpenAICompatibleProvider } from '../dist/providers.js'
import { createMockProviderServer } from './helpers/mock_provider_server.mjs'

const completion = (message, finish_reason = 'stop') => ({
  id: 'mock', model: 'mock', choices: [{ finish_reason, message }]
})

test('mock server drives agent loop and preserves then resets conversation history', async () => {
  const server = await createMockProviderServer([
    { body: completion({ role: 'assistant', content: null, tool_calls: [{ id: 'todo-call-1', type: 'function', function: { name: 'todo_list', arguments: '{}' } }] }, 'tool_calls') },
    { body: completion({ role: 'assistant', content: 'tool result consumed' }) },
    { body: completion({ role: 'assistant', content: 'second reply' }) },
    { body: completion({ role: 'assistant', content: 'after reset' }) }
  ])
  try {
    const agent = new AIAgent()
    agent.config.context_windows = { mock: 65_536 }
    agent.provider = new OpenAICompatibleProvider('mock', server.url, '', 'mock')
    agent.toolWhitelist = ['todo_list']
    agent.resetSession()
    const first = await agent.chat('unique first message')
    assert.equal(first.contextWindow, 65_536)
    assert.equal(first.toolCalls, 1)
    assert.ok(server.requests[1].messages.some(m => m.role === 'tool' && m.tool_call_id === 'todo-call-1'))
    await agent.chat('second')
    assert.ok(server.requests[2].messages.some(m => m.role === 'user' && m.content === 'unique first message'))
    agent.resetSession()
    await agent.chat('after reset')
    assert.equal(server.requests[3].messages.some(m => m.role === 'user' && m.content === 'unique first message'), false)
  } finally { await server.close() }
})

test('provider 400 reports request shape without leaking prompt contents', async () => {
  const server = await createMockProviderServer([
    { status: 400, body: { error: { message: 'Invalid request' } } }
  ])
  try {
    const provider = new OpenAICompatibleProvider('mock', server.url, '', 'mock')
    await assert.rejects(
      provider.chat({
        model: 'mock',
        messages: [{ role: 'user', content: 'PRIVATE_PROMPT_SENTINEL' }],
        tools: [{ type: 'function', function: { name: 'test_tool' } }],
        max_tokens: 123
      }),
      error => {
        assert.match(error.message, /request diagnostics/)
        assert.match(error.message, /messages=1/)
        assert.match(error.message, /tools=1/)
        assert.match(error.message, /max_tokens=123/)
        assert.doesNotMatch(error.message, /PRIVATE_PROMPT_SENTINEL/)
        return true
      }
    )
  } finally { await server.close() }
})

test('mock server returns tool calls and HTTP 429 errors', async () => {
  const server = await createMockProviderServer([
    { body: completion({ role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'list_directory', arguments: '{"path":"."}' } }] }, 'tool_calls') },
    { status: 429, body: { error: { message: 'rate limited' } } },
    { status: 429, body: { error: { message: 'rate limited' } } },
    { status: 429, body: { error: { message: 'rate limited' } } }
  ])
  try {
    const provider = new OpenAICompatibleProvider('mock', server.url, '', 'mock')
    const request = { model: 'mock', messages: [{ role: 'user', content: 'test' }] }
    const result = await provider.chat(request)
    assert.equal(result.choices[0].finish_reason, 'tool_calls')
    await assert.rejects(provider.chat(request), /429|rate limit/i)
  } finally { await server.close() }
})

test('agent interrupt cancels in-flight provider request', async () => {
  const server = await createMockProviderServer([
    { hang: true },
    { body: completion({ role: 'assistant', content: 'next turn works' }) }
  ])
  try {
    const agent = new AIAgent()
    agent.provider = new OpenAICompatibleProvider('mock', server.url, '', 'mock')
    const pending = agent.chat('cancel this turn')
    await server.waitForRequest()
    assert.equal(agent.interrupt(), true)
    assert.match((await pending).response, /Interrupted by user/)
    assert.equal(agent.interrupt(), false)
    assert.equal((await agent.chat('next turn')).response, 'next turn works')
  } finally { await server.close() }
})

test('mock server can hang and provider request times out', async () => {
  const server = await createMockProviderServer([{ hang: true }])
  try {
    const provider = new OpenAICompatibleProvider('mock', server.url, '', 'mock')
    await assert.rejects(provider.chat({ model: 'mock', messages: [{ role: 'user', content: 'wait' }], timeout: 100 }), /timeout|abort/i)
  } finally { await server.close() }
})
