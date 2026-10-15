import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompt, createSummarizer, pickSummarizerProvider, summarizeWithProvider } from '../dist/summarizer.js'
import { buildSummarizePrompt, countSummaryBlocks, isSummaryBlock, mergeSummaryInputs, normalizeSummary, summarizeBlocks } from '../dist/compaction.js'

const fakeProvider = (reply, { throws = false, calls = [] } = {}) => ({
  name: 'fake',
  baseURL: 'http://127.0.0.1:1/v1',
  apiKey: '',
  model: 'cheap-model',
  chat: async request => {
    calls.push(request)
    if (throws) throw new Error('provider down')
    return { id: 'x', model: request.model, choices: [{ message: { role: 'assistant', content: reply } }] }
  }
})

test('compaction: normalizeSummary strips fences and enforces the cap', () => {
  assert.equal(normalizeSummary('```md\nGoal: fix bug\n```', 100), 'Goal: fix bug')
  assert.equal(normalizeSummary('   ', 100), null)
  assert.equal(normalizeSummary('', 10), null)
  const capped = normalizeSummary('x'.repeat(50), 10)
  assert.equal(capped.length, 10)
  assert.ok(capped.endsWith('…'))
})

test('compaction: summary blocks are detected and mergeable', () => {
  const history = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '[Summary of earlier work (3 messages compacted):\nGoal: x\n[End summary]' },
    { role: 'assistant', content: 'Summary noted. Continuing.' },
    { role: 'user', content: 'real request' },
    { role: 'user', content: '[Context summary (5 messages compacted)]\nGoal: y' }
  ]
  assert.equal(isSummaryBlock(history[1]), true)
  assert.equal(isSummaryBlock(history[3]), false)
  assert.equal(isSummaryBlock(history[4]), true)
  assert.equal(countSummaryBlocks(history), 2)
  const merged = mergeSummaryInputs(history)
  assert.match(merged, /Goal: x/)
  assert.match(merged, /Goal: y/)
})

test('compaction: summarizeBlocks falls back to null when the model fails', async () => {
  const failing = createSummarizer({ provider: fakeProvider('', { throws: true }) })
  assert.equal(await summarizeBlocks('material', 200, failing), null)

  const empty = createSummarizer({ provider: fakeProvider('') })
  assert.equal(await summarizeBlocks('material', 200, empty), null)
})

test('summarizer: sends a factual handover prompt at temperature 0 and returns the note', async () => {
  const calls = []
  const provider = fakeProvider('Goal: ship the fix\nFiles: a.ts\nUnfinished: tests', { calls })
  const summarizer = createSummarizer({ provider, maxOutputTokens: 500 })
  const result = await summarizeWithProvider(summarizer, 'raw material', 400)

  assert.match(result, /Goal: ship the fix/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].temperature, 0)
  assert.equal(calls[0].max_tokens, 500)
  assert.equal(calls[0].model, 'cheap-model')
  assert.equal(calls[0].stream, undefined, 'summary calls are not streamed')
  assert.match(calls[0].messages[1].content, /Do not invent anything/)
  assert.match(calls[0].messages[1].content, /raw material/)
})

test('summarizer: aborted signal means no model call at all', async () => {
  const calls = []
  const summarizer = createSummarizer({ provider: fakeProvider('nope', { calls }) })
  const controller = new AbortController()
  controller.abort()
  assert.equal(await summarizeWithProvider(summarizer, 'material', 100, controller.signal), null)
  assert.equal(calls.length, 0)
})

test('summarizer: aux provider wins over the active provider when configured', () => {
  const active = fakeProvider('active')
  active.name = 'active'
  const built = []
  const create = (name, baseURL, apiKey, model) => {
    built.push({ name, baseURL, model })
    return { ...fakeProvider('aux'), name, baseURL, model }
  }

  const picked = pickSummarizerProvider(active, create, {
    providers: { cheap: { base_url: 'http://127.0.0.1:9999/v1', api_key: 'k', model: 'tiny' } },
    auxiliary: { provider: 'cheap', model: 'tiny-2' }
  })
  assert.equal(picked.provider.name, 'cheap')
  assert.equal(picked.model, 'tiny-2')
  assert.equal(built[0].baseURL, 'http://127.0.0.1:9999/v1')

  // Missing aux entry falls back to the active provider.
  const fallback = pickSummarizerProvider(active, create, { auxiliary: { provider: 'nope' } })
  assert.equal(fallback.provider, active)
})

test('summarizer: buildPrompt keeps the hard constraints', () => {
  const prompt = buildPrompt('MATERIAL', 250)
  assert.match(prompt, /Maximum 250 characters/)
  assert.match(prompt, /Do not invent anything/)
  assert.match(prompt, /MATERIAL/)
  assert.match(buildSummarizePrompt('X', 50), /Maximum 50 characters/)
})
