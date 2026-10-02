import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AIAgent } from '../dist/agent.js'
import { registry } from '../dist/tools.js'
import { MemoryStore } from '../dist/memory.js'

test('Subagent Delegation Depth Guard (No recursive delegation)', async (t) => {
  const agent = new AIAgent({ isSubagent: true })
  
  // 1. Tool schema filtering: delegate_task must not be exposed to subagent
  const originalChat = agent.provider.chat.bind(agent.provider)
  let offeredTools = []

  agent.provider.chat = async (req) => {
    offeredTools = req.tools || []
    return {
      id: 'subagent-mock',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Subagent finished.' },
        finish_reason: 'stop'
      }]
    }
  }

  try {
    await agent.chat('Subagent task')
    const hasDelegateTask = offeredTools.some(t => t.function?.name === 'delegate_task')
    assert.equal(hasDelegateTask, false, 'delegate_task must not be offered to subagent')
  } finally {
    agent.provider.chat = originalChat
  }

  // 2. Direct execution guard via registry with isSubagent: true
  const directCallResult = await registry.execute('delegate_task', { tasks: [{ goal: 'test' }] }, { isSubagent: true })
  const parsed = JSON.parse(directCallResult)
  assert.ok(parsed.error)
  assert.ok(parsed.error.includes('Subagents cannot call delegate_task') || parsed.error.includes('Tool not found'))
})

test('Context Stores Isolation in Tools', async (t) => {
  const tmpA = mkdtempSync(join(tmpdir(), 'vallen-store-a-'))
  const tmpB = mkdtempSync(join(tmpdir(), 'vallen-store-b-'))

  try {
    const memA = new MemoryStore(tmpA)
    const memB = new MemoryStore(tmpB)

    // Execute memory tool with store A
    await registry.execute('memory', { action: 'add', target: 'memory', content: 'Note for Store A' }, {
      stores: { memory: memA }
    })

    // Execute memory tool with store B
    await registry.execute('memory', { action: 'add', target: 'memory', content: 'Note for Store B' }, {
      stores: { memory: memB }
    })

    assert.ok(memA.formatForSystemPrompt().includes('Note for Store A'))
    assert.equal(memA.formatForSystemPrompt().includes('Note for Store B'), false)

    assert.ok(memB.formatForSystemPrompt().includes('Note for Store B'))
    assert.equal(memB.formatForSystemPrompt().includes('Note for Store A'), false)
  } finally {
    if (existsSync(tmpA)) rmSync(tmpA, { recursive: true, force: true })
    if (existsSync(tmpB)) rmSync(tmpB, { recursive: true, force: true })
  }
})

test('Empty Assistant Response Fallback Handling', async (t) => {
  const agent = new AIAgent()
  const originalChat = agent.provider.chat.bind(agent.provider)

  agent.provider.chat = async () => {
    return {
      id: 'mock-empty-response',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: '' },
        finish_reason: 'stop'
      }]
    }
  }

  try {
    const res = await agent.chat('test prompt')
    assert.ok(res.response.includes('No content returned by model'))
    
    // In history, assistant message must not be empty string
    const history = agent.conversationHistory
    const lastAssistant = history.filter(m => m.role === 'assistant').pop()
    assert.ok(lastAssistant)
    assert.ok(lastAssistant.content.length > 0)
    assert.ok(lastAssistant.content.includes('No content returned by model'))
  } finally {
    agent.provider.chat = originalChat
  }
})
