import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildPlanPrompt, listPlans, PLAN_MODE_RULES, PLAN_CRAFT } from '../dist/plan_prompt.js'
import { AIAgent } from '../dist/agent.js'

test('/plan — Prompt Builder & Rules', (t) => {
  // 1. Task included verbatim
  const task = 'migrate auth provider to OIDC with zero downtime'
  const prompt = buildPlanPrompt(task)
  assert.ok(prompt.startsWith('[/plan — plan mode]'))
  assert.ok(prompt.includes(task))
  assert.ok(prompt.includes('Task to plan:'))

  // 2. Empty task infers from conversation context
  const emptyPrompt = buildPlanPrompt('')
  assert.ok(emptyPrompt.includes('infer the task from the current conversation context'))

  const whitespacePrompt = buildPlanPrompt('   ')
  assert.ok(whitespacePrompt.includes('infer the task from the current conversation context'))

  // 3. Ground rules match Hermes invariants
  assert.ok(prompt.includes('PLAN MODE — planning only'))
  assert.ok(prompt.includes('Do not implement code.'))
  assert.ok(prompt.includes('Do not edit project files except the plan markdown file itself.'))
  assert.ok(prompt.includes('Do not run mutating terminal commands'))
  assert.ok(prompt.includes('.vallenatrix/plans/YYYY-MM-DD_HHMMSS-<slug>.md'))

  // 4. Plan craft structure
  assert.ok(prompt.includes('Goal — one sentence.'))
  assert.ok(prompt.includes('Current context / assumptions.'))
  assert.ok(prompt.includes('Architecture / proposed approach'))
  assert.ok(prompt.includes('Step-by-step tasks.'))
  assert.ok(prompt.includes('Tests / validation'))
  assert.ok(prompt.includes('Risks, tradeoffs, and open questions.'))
  assert.ok(prompt.includes('do not start executing in this turn.'))
})

test('/plans — List Saved Plans', (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'vallen-plans-test-'))
  try {
    // Empty when no plans dir
    assert.deepEqual(listPlans(tmpDir), [])

    // Create plans dir
    const plansDir = join(tmpDir, '.vallenatrix', 'plans')
    mkdirSync(plansDir, { recursive: true })

    assert.deepEqual(listPlans(tmpDir), [])

    // Create plan files
    const file1 = join(plansDir, '2026-10-02_120000-auth-migration.md')
    const file2 = join(plansDir, '2026-10-02_130000-sqlite-storage.md')
    writeFileSync(file1, '# Auth Migration Plan\n\nGoal: migrate auth.', 'utf-8')
    writeFileSync(file2, '# SQLite Storage Plan\n\nGoal: sqlite store.', 'utf-8')

    const plans = listPlans(tmpDir)
    assert.equal(plans.length, 2)
    assert.ok(plans.some(p => p.filename === '2026-10-02_120000-auth-migration.md'))
    assert.ok(plans.some(p => p.filename === '2026-10-02_130000-sqlite-storage.md'))
  } finally {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }
})

test('/plan — AIAgent Input Queue Interception', async (t) => {
  const agent = new AIAgent()
  // Mock provider so we don't make real network calls in this test
  const originalChat = agent.provider.chat.bind(agent.provider)
  let receivedMessageContent = ''

  agent.provider.chat = async (req) => {
    const userMsg = req.messages.find(m => m.role === 'user')
    receivedMessageContent = userMsg?.content || ''
    return {
      id: 'mock-chat-1',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Plan created under .vallenatrix/plans/2026-10-02_140000-test-feature.md'
        },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    }
  }

  try {
    const res = await agent.chat('/plan build oauth integration')
    assert.ok(receivedMessageContent.startsWith('[/plan — plan mode]'))
    assert.ok(receivedMessageContent.includes('build oauth integration'))
    assert.ok(receivedMessageContent.includes('.vallenatrix/plans/YYYY-MM-DD_HHMMSS-<slug>.md'))
    assert.ok(res.response.includes('.vallenatrix/plans/'))
  } finally {
    agent.provider.chat = originalChat
  }
})
