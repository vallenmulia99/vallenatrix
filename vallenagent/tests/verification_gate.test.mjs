import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { OpenAICompatibleProvider } from '../dist/providers.js'
import { createMockProviderServer } from './helpers/mock_provider_server.mjs'

const completion = message => ({ id: 'mock', model: 'mock', choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] })

test('agent reports incomplete when TypeScript changes lack a successful typecheck', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'verification-gate-'))
  const source = join(dir, 'changed.ts')
  const server = await createMockProviderServer([
    { body: completion({ role: 'assistant', content: null, tool_calls: [{ id: 'write-ts', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: source, content: 'export const value = 1\n' }) } }] }) },
    { body: completion({ role: 'assistant', content: 'done' }) },
    { body: completion({ role: 'assistant', content: 'still done' }) }
  ])
  try {
    const agent = new AIAgent({ sessionDir: dir, sessionId: 'verification-ts-gate' })
    agent.config.terminal = { cwd: dir }
    agent.toolWhitelist = ['write_file']
    agent.provider = new OpenAICompatibleProvider('mock', server.url, '', 'mock')
    const result = await agent.chat('Write a TypeScript file')
    assert.equal(readFileSync(source, 'utf8'), 'export const value = 1\n')
    assert.equal(result.completionStatus, 'incomplete')
    assert.match(result.response, /lack a successful typecheck/i)
    assert.equal(server.requests.length, 3)
  } finally {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
