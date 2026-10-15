import test from 'node:test'
import assert from 'node:assert/strict'
import { createReviewSnapshot, shouldRunBackgroundReview, ReviewRunGate, spawnBackgroundReview } from '../dist/background_review.js'

test('review policy skips ordinary turns until interval and triggers on correction or many tools', () => {
  assert.equal(shouldRunBackgroundReview('add a README', 1, 0), false)
  assert.equal(shouldRunBackgroundReview('continue', 4, 0), false)
  assert.equal(shouldRunBackgroundReview('continue', 5, 0), true)
  assert.equal(shouldRunBackgroundReview('No, I meant the other file', 1, 0), true)
  assert.equal(shouldRunBackgroundReview('continue', 1, 8), true)
})

test('review snapshot excludes system, keeps recent 12, truncates tools, and caps total size', () => {
  const messages = [{ role: 'system', content: 'private system prompt' }, ...Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 ? 'tool' : 'user', content: `${i}:${'x'.repeat(6000)}`, name: i % 2 ? 'read_file' : undefined,
    tool_calls: i === 19 ? [{ id: 'call', type: 'function', function: { name: 'tool', arguments: 'x'.repeat(5000) } }] : undefined
  }))]
  const snapshot = createReviewSnapshot(messages)
  assert.equal(snapshot.length <= 12, true)
  assert.equal(snapshot.some(message => message.content.includes('private system prompt')), false)
  assert.equal(snapshot.some(message => message.role === 'tool' && message.content.length > 500), false)
  assert.equal(JSON.stringify(snapshot).length <= 20_000, true)
})

test('review gate blocks overlap and can be reused after completion', () => {
  const gate = new ReviewRunGate()
  assert.equal(gate.tryStart(), true)
  assert.equal(gate.tryStart(), false)
  gate.finish()
  assert.equal(gate.tryStart(), true)
})

test('review agent receives fresh memory block', async () => {
  let prompt = ''
  let done
  const complete = new Promise(resolve => { done = resolve })
  await spawnBackgroundReview([], async (_userPrompt, systemPrompt) => { prompt = systemPrompt; done(); return 'No updates needed' }, undefined, 'LATEST MEMORY DATA')
  await complete
  assert.match(prompt, /LATEST MEMORY DATA/)
})
