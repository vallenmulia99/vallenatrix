import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'

test('a model switch during tool turn applies only to next turn', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-turn-model-'))
  const previousHome = process.env.VALLENATRIX_HOME
  process.env.VALLENATRIX_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.VALLENATRIX_HOME
    else process.env.VALLENATRIX_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  const agent = new AIAgent({ isSubagent: true })
  const originalModel = agent.provider.model
  const requestedModels = []
  let signalStarted
  const started = new Promise((resolve) => { signalStarted = resolve })
  let continueFirst
  const gate = new Promise((resolve) => { continueFirst = resolve })
  const fakeChat = async ({ model }) => {
    requestedModels.push(model)
    if (requestedModels.length === 1) {
      signalStarted()
      await gate
      return { choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'missing_test_tool', arguments: '{}' } }] } }] }
    }
    return { choices: [{ message: { content: 'done' } }] }
  }
  agent.provider.chat = fakeChat
  const setModel = agent.setModel.bind(agent)
  agent.setModel = (model) => {
    setModel(model)
    agent.provider.chat = fakeChat
  }

  const turn = agent.chat('test turn')
  await started
  agent.setModel('test-next-model')
  continueFirst()
  await turn
  assert.deepEqual(requestedModels, [originalModel, originalModel])
})
