import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAICompatibleProvider } from '../dist/providers.js'

function sseResponse(chunks) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  }), { headers: { 'content-type': 'text/event-stream' } })
}

function run(chunks) {
  let requestBody
  const provider = new OpenAICompatibleProvider('test', 'https://example.test/v1', '', 'model')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return sseResponse(chunks)
  }
  return provider.chat({ model: 'model', messages: [], stream: true, onChunk() {} })
    .then(result => ({ result, requestBody }))
    .finally(() => { globalThis.fetch = originalFetch })
}

test('SSE accepts data: with and without space', async () => {
  const { result } = await run(['data:{"choices":[{"delta":{"content":"a"}}]}\n', 'data: {"choices":[{"delta":{"content":"b"}}]}\n'])
  assert.equal(result.choices[0].message.content, 'ab')
})

test('SSE flushes final buffered event and UTF-8 decoder at EOF', async () => {
  const { result } = await run(['data: {"choices":[{"delta":{"content":"☃"}}]}'])
  assert.equal(result.choices[0].message.content, '☃')
})

test('SSE tool-call index zero distinguishes calls by id', async () => {
  const { result } = await run([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"one","arguments":"{}"}}]}}]}\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_b","function":{"name":"two","arguments":"[]"}}]}}]}\n'
  ])
  assert.deepEqual(result.choices[0].message.tool_calls.map(c => [c.id, c.function.name, c.function.arguments]), [['call_a', 'one', '{}'], ['call_b', 'two', '[]']])
})

test('SSE error event rejects chat request', async () => {
  await assert.rejects(run(['event: error\ndata: {"error":{"message":"stream broke"}}\n']), /stream broke/)
})

test('stream request asks for usage and supplies fetch timeout', async () => {
  const { requestBody } = await run(['data: [DONE]\n'])
  assert.deepEqual(requestBody.stream_options, { include_usage: true })
})
