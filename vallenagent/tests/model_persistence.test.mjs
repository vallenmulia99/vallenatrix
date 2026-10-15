import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { loadConfig } from '../dist/config.js'

const originalHome = process.env.VALLENATRIX_HOME
const testHome = mkdtempSync(join(tmpdir(), 'vallenatrix-model-'))
process.env.VALLENATRIX_HOME = testHome

test('setModel persists active provider model for a fresh agent', (t) => {
  const agent = new AIAgent()
  const selected = 'cl/openai/test-persistent-model'
  agent.setModel(selected)
  const restartedAgent = new AIAgent()
  assert.equal(restartedAgent.provider.model, selected)
  assert.equal(loadConfig().providers['9router'].model, selected)
  if (originalHome === undefined) delete process.env.VALLENATRIX_HOME
  else process.env.VALLENATRIX_HOME = originalHome
  rmSync(testHome, { recursive: true, force: true })
})
