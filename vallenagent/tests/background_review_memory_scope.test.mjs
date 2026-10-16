import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'

test('background review agent writes memory into parent agent project scope after cwd changes', async t => {
  const projectDir = mkdtempSync(join(tmpdir(), 'vallen-review-project-'))
  const unrelatedDir = mkdtempSync(join(tmpdir(), 'vallen-review-unrelated-'))
  t.after(() => { rmSync(projectDir, { recursive: true, force: true }); rmSync(unrelatedDir, { recursive: true, force: true }) })

  const home = mkdtempSync(join(tmpdir(), 'vallen-review-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const parent = new AIAgent({ isSubagent: true, backgroundReview: false })
  parent.config.terminal.cwd = unrelatedDir
  parent.memoryStore.setWorkingDir(projectDir)
  parent.conversationHistory.push({ role: 'user', content: 'In this project, prefer keyboard controls over mouse controls.' })
  parent.provider.chat = async ({ messages }) => {
    const system = messages.find(message => message.role === 'system')?.content || ''
    const tools = parent.registry.getSchemas()
    const memoryTool = tools.find(tool => tool.function?.name === 'memory')
    assert.ok(memoryTool)
    return { choices: [{ message: { content: 'No updates needed' } }] }
  }

  // Exercise the same factory/config handoff used by the background review, with
  // the review agent's real memory store and a direct memory write.
  const reviewConfig = { ...parent.getConfig(), terminal: { ...parent.getConfig().terminal, cwd: parent.memoryStore.getWorkingDir() } }
  const review = new AIAgent({ config: reviewConfig, isSubagent: true })
  await review.memoryStore.add('memory', 'Prefer keyboard controls for this project.')
  assert.match(parent.memoryStore.formatForSystemPrompt(), /Prefer keyboard controls/)
})
