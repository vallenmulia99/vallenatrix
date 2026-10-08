import test from 'node:test'
import assert from 'node:assert/strict'
import { registry } from '../dist/tools.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

test('web_extract blocks loopback IPv6 and metadata targets', async () => {
  registerBuiltinTools(null, null, null, async () => '', false)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('fetch must not run for private targets') }
  try {
    const result = JSON.parse(await registry.execute('web_extract', { urls: ['http://[::1]/', 'http://0.0.0.0/', 'http://169.254.169.254/'] }))
    assert.equal(result.results.length, 3)
    assert.ok(result.results.every((item) => item.error?.includes('Private IP')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web_extract does not follow redirects', async () => {
  registerBuiltinTools(null, null, null, async () => '', false)
  const originalFetch = globalThis.fetch
  let options
  globalThis.fetch = async (_url, opts) => {
    options = opts
    return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } })
  }
  try {
    const result = JSON.parse(await registry.execute('web_extract', { urls: ['https://example.com/'] }))
    assert.equal(options.redirect, 'manual')
    assert.equal(result.results[0].error, 'HTTP 302: ')
  } finally {
    globalThis.fetch = originalFetch
  }
})