import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'
import { AIAgent } from '../dist/agent.js'
import { OpenAICompatibleProvider } from '../dist/providers.js'
import { createMockProviderServer } from './helpers/mock_provider_server.mjs'

const completion = message => ({ id: 'mock', model: 'mock', choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] })

test('deferred tools stay out of model schema but searchable and describable on demand', async () => {
  registerBuiltinTools(new SkillLoader([mkdtempSync(join(tmpdir(), 'tool-search-'))]), undefined, undefined, undefined, false)
  const visible = registry.getOpenAISchemas().map(item => item.function.name)
  assert.ok(visible.includes('tool_search'))
  assert.ok(visible.includes('tool_describe'))
  assert.ok(visible.includes('tool_call'))
  assert.equal(visible.includes('web_search'), false)
  const search = JSON.parse(await registry.execute('tool_search', { query: 'search web' }))
  assert.ok(search.results.some(item => item.name === 'web_search'))
  const description = JSON.parse(await registry.execute('tool_describe', { name: 'web_search' }))
  assert.equal(description.name, 'web_search')
})

test('tool_call routes through runtime and respects deferred-tool whitelist', async () => {
  const server = await createMockProviderServer([
    { body: completion({ role: 'assistant', content: null, tool_calls: [{ id: 'deferred-1', type: 'function', function: { name: 'tool_call', arguments: JSON.stringify({ name: 'manage_connections', arguments: {} }) } }] }) },
    { body: completion({ role: 'assistant', content: 'done' }) }
  ])
  try {
    const agent = new AIAgent()
    agent.provider = new OpenAICompatibleProvider('mock', server.url, '', 'mock')
    agent.toolWhitelist = ['tool_call', 'manage_connections']
    const result = await agent.chat('check local environment')
    assert.equal(result.response, 'done')
    assert.ok(server.requests[1].messages.some(message => message.role === 'tool' && message.tool_call_id === 'deferred-1' && /Hosted connectors are not integrated/.test(message.content)))
  } finally { await server.close() }
})
