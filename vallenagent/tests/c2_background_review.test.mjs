import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnBackgroundReview } from '../dist/background_review.js'

test('background review passes conversation snapshot to review prompt', async () => {
  const snapshot = [{ role: 'user', content: 'Remember this exact preference' }]
  let receivedPrompt = ''
  await spawnBackgroundReview(snapshot, async prompt => {
    receivedPrompt = prompt
    return 'No updates needed'
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(receivedPrompt, /Remember this exact preference/)
})