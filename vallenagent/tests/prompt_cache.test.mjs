import test from 'node:test'
import assert from 'node:assert/strict'
import { markCachePrefix, stripCacheMarkers, supportsPromptCache, hasCacheMarkers } from '../dist/prompt_cache.js'

test('prompt_cache: only marks the stable prefix, never tool messages', () => {
  const messages = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'first request' },
    { role: 'assistant', content: 'thinking' },
    { role: 'tool', content: '{"exit_code":0}', name: 'terminal' },
    { role: 'user', content: 'latest request' }
  ]

  const marked = markCachePrefix(messages, { prefixMessages: 3 })
  assert.deepEqual(marked[0].cache_control, { type: 'ephemeral' })
  assert.deepEqual(marked[1].cache_control, { type: 'ephemeral' })
  assert.deepEqual(marked[2].cache_control, { type: 'ephemeral' })
  assert.equal(marked[3].cache_control, undefined, 'tool output is volatile')
  assert.equal(marked[4].cache_control, undefined, 'the newest user turn is volatile')

  // Default: system prompt only.
  const minimal = markCachePrefix(messages)
  assert.deepEqual(minimal[0].cache_control, { type: 'ephemeral' })
  assert.equal(minimal[1].cache_control, undefined)

  // Input is never mutated.
  assert.equal(messages[0].cache_control, undefined)
})

test('prompt_cache: empty content and non-message roles are left alone', () => {
  const messages = [
    { role: 'system', content: '' },
    { role: 'user', content: 'x' }
  ]
  const marked = markCachePrefix(messages, { prefixMessages: 2 })
  assert.equal(marked[0].cache_control, undefined)
  assert.deepEqual(marked[1].cache_control, { type: 'ephemeral' })
  assert.deepEqual(markCachePrefix([], {}), [])
})

test('prompt_cache: stripCacheMarkers removes markers without touching other fields', () => {
  const marked = markCachePrefix([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' }
  ])
  assert.equal(hasCacheMarkers(marked), true)
  const stripped = stripCacheMarkers(marked)
  assert.equal(hasCacheMarkers(stripped), false)
  assert.deepEqual(stripped, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }])
  // No-op on unmarked input.
  assert.deepEqual(stripCacheMarkers([{ role: 'user', content: 'hi' }]), [{ role: 'user', content: 'hi' }])
})

test('prompt_cache: supported models get markers, others do not', () => {
  assert.equal(supportsPromptCache('claude-3-5-sonnet'), true)
  assert.equal(supportsPromptCache('anthropic/claude-sonnet-4'), true)
  assert.equal(supportsPromptCache('gemini-2.5-pro'), true)
  assert.equal(supportsPromptCache('ag/gemini-3.8-flash-medium'), true)
  assert.equal(supportsPromptCache('gpt-4o'), false)
  assert.equal(supportsPromptCache(undefined, 'https://openrouter.ai/api/v1'), true)
})

test('prompt_cache: env kill switch disables markers entirely', () => {
  const previous = process.env.VALLENATRIX_PROMPT_CACHE
  try {
    process.env.VALLENATRIX_PROMPT_CACHE = 'off'
    assert.equal(supportsPromptCache('claude-3-5-sonnet'), false)
  } finally {
    if (previous === undefined) delete process.env.VALLENATRIX_PROMPT_CACHE
    else process.env.VALLENATRIX_PROMPT_CACHE = previous
  }
  assert.equal(supportsPromptCache('claude-3-5-sonnet'), true)
})
