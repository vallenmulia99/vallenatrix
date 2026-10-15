import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { OpenAICompatibleProvider } from '../dist/providers.js'

async function withSse(t, chunks) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const chunk of chunks) res.write(chunk)
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const provider = new OpenAICompatibleProvider('test', `http://127.0.0.1:${server.address().port}`, '', 'test')
  let body
  const fetchImpl = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    body = JSON.parse(options.body)
    return fetchImpl(url, options)
  }
  t.after(() => { globalThis.fetch = fetchImpl })
  return { provider, getBody: () => body }
}

test('SSE accepts data without space, flushes final event, separates colliding tool indexes, reports errors and requests usage', async (t) => {
  const { provider, getBody } = await withSse(t, [
    'data:{"choices":[{"delta":{"content":"A"}}]}\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"read_file","arguments":"{}"}},{"index":0,"id":"b","function":{"name":"read_file","arguments":"{}"}}]}}]}\n',
    'data: {"choices":[{"delta":{"content":"B"}}]}',
  ])
  const result = await provider.chat({ model: 'test', messages: [], stream: true, onChunk: () => {} })
  assert.equal(result.choices[0].message.content, 'AB')
  assert.deepEqual(result.choices[0].message.tool_calls.map(x => [x.id, x.function.name, x.function.arguments]), [['a', 'read_file', '{}'], ['b', 'read_file', '{}']])
  assert.deepEqual(getBody().stream_options, { include_usage: true })
})

test('SSE provider error event throws', async (t) => {
  const { provider } = await withSse(t, ['data: {"error":{"message":"overloaded"}}'])
  await assert.rejects(provider.chat({ model: 'test', messages: [], stream: true, onChunk: () => {} }), /overloaded/)
})
