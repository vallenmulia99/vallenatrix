import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { OpenAICompatibleProvider } from '../dist/providers.js'

function startServer(handler) {
  const server = createServer(handler)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}/v1`,
      close: () => new Promise(done => server.close(done))
    }))
  })
}

test('provider retries transient HTTP response once without duplicating streamed output', async t => {
  let requests = 0
  const server = await startServer((req, res) => {
    requests++
    if (requests === 1) {
      res.writeHead(503, { 'retry-after': '0.001' })
      res.end('busy')
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"once"}}]}\n\ndata: [DONE]\n\n')
  })
  t.after(server.close)
  const provider = new OpenAICompatibleProvider('test', server.url, '', 'test')
  const chunks = []
  const result = await provider.chat({ model: 'test', messages: [], stream: true, onChunk: chunk => chunks.push(chunk) })
  assert.equal(requests, 2)
  assert.deepEqual(chunks, ['once'])
  assert.equal(result.choices[0].message.content, 'once')
})

test('abort cancels provider retry backoff without another request', async t => {
  let requests = 0
  const server = await startServer((req, res) => {
    requests++
    res.writeHead(503, { 'retry-after': '5' })
    res.end('busy')
  })
  t.after(server.close)
  const provider = new OpenAICompatibleProvider('test', server.url, '', 'test')
  const controller = new AbortController()
  const started = Date.now()
  const pending = provider.chat({ model: 'test', messages: [], signal: controller.signal })
  while (requests === 0) await new Promise(resolve => setTimeout(resolve, 1))
  await new Promise(resolve => setTimeout(resolve, 30))
  controller.abort()
  await assert.rejects(pending, /abort/i)
  assert.ok(Date.now() - started < 500, 'abort should interrupt retry delay')
  assert.equal(requests, 1)
})

test('provider retry delays respect one overall request deadline', async t => {
  let requests = 0
  const server = await startServer((req, res) => {
    requests++
    res.writeHead(503, { 'retry-after': '0.2' })
    res.end('busy')
  })
  t.after(server.close)
  const provider = new OpenAICompatibleProvider('test', server.url, '', 'test')
  const started = Date.now()
  await assert.rejects(provider.chat({ model: 'test', messages: [], timeout: 250 }), /timeout|deadline/i)
  assert.ok(Date.now() - started < 450, 'retry budget must not multiply per-attempt timeout')
  assert.ok(requests <= 2)
})

test('provider does not retry after emitting partial stream output', async t => {
  let requests = 0
  const server = await startServer((req, res) => {
    requests++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
    setTimeout(() => res.socket.destroy(), 40)
  })
  t.after(server.close)
  const provider = new OpenAICompatibleProvider('test', server.url, '', 'test')
  const chunks = []
  await assert.rejects(provider.chat({ model: 'test', messages: [], stream: true, onChunk: chunk => chunks.push(chunk) }))
  assert.deepEqual(chunks, ['partial'])
  assert.equal(requests, 1)
})