import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnBackgroundReview } from '../dist/background_review.js'

test('background review passes snapshot, excludes terminal, and suppresses empty notices', async () => {
  const snapshot = [{ role: 'user', content: 'Remember this exact preference' }]
  let receivedPrompt = ''
  let systemPrompt = ''
  let whitelist = []
  let completed = false
  await spawnBackgroundReview(snapshot, async (prompt, system, tools) => {
    receivedPrompt = prompt
    systemPrompt = system
    whitelist = tools
    return 'No updates needed'
  }, { onReviewComplete: () => { completed = true } })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(receivedPrompt, /Remember this exact preference/)
  assert.match(systemPrompt, /Never use terminal/)
  assert.ok(!whitelist.includes('terminal'))
  assert.deepEqual(whitelist, ['skill_view', 'skills_list', 'skill_manage', 'memory', 'read_file', 'search_files'])
  assert.equal(completed, false)
})

test('background review sends concise verified update notice', async () => {
  let notice = ''
  await spawnBackgroundReview([], async () => JSON.stringify({ updated: [{ kind: 'skill', name: 'test-driven-development', change: 'added pitfall' }] }), {
    onReviewComplete: summary => { notice = summary }
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(notice, 'Self-review saved: skill test-driven-development (added pitfall)')
})
