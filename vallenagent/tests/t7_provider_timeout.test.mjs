import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { OpenAICompatibleProvider } from '../dist/providers.js'

test('provider chat rejects before timeout + 1 second on hanging server', async () => {
  const server = http.createServer((_req, _res) => {
    // Hang forever
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const provider = new OpenAICompatibleProvider('test', `http://127.0.0.1:${port}/v1`, '', 'test-model')

  const timeoutMs = 400
  const start = Date.now()
  let threw = false
  try {
    await provider.chat({
      model: 'test',
      messages: [{ role: 'user', content: 'hello' }],
      timeout: timeoutMs
    })
  } catch (err) {
    threw = true
  } finally {
    server.close()
  }

  const duration = Date.now() - start
  assert.equal(threw, true, 'chat must reject on timeout')
  assert.ok(duration < timeoutMs + 1000, `Expected < ${timeoutMs + 1000}ms, took ${duration}ms`)
})
