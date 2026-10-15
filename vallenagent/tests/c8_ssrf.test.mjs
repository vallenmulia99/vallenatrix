import test from 'node:test'
import assert from 'node:assert/strict'
import { registry } from '../dist/tools.js'
import { registerBuiltinTools, fetchSafeUrl } from '../dist/builtin_tools.js'
import dns from 'node:dns'
import { EventEmitter } from 'node:events'

 test('BUG-07 pins request DNS lookup to the address that passed validation', async () => {
  const originalLookup = dns.promises.lookup
  let lookupCount = 0
  dns.promises.lookup = async () => {
    lookupCount++
    const address = lookupCount === 1 ? '93.184.216.34' : '127.0.0.1'
    return [{ address, family: 4 }]
  }
  const pinned = []
  const fakeRequester = (url, options, onResponse) => {
    const request = new EventEmitter()
    request.setTimeout = () => request
    request.end = () => {
      options.lookup(url.hostname, { all: false }, (_err, address) => {
        pinned.push(address)
        options.lookup(url.hostname, { all: false }, (_err2, secondAddress) => {
          pinned.push(secondAddress)
          onResponse({ statusCode: 200, statusMessage: 'OK', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from('ok') } })
        })
      })
    }
    return request
  }
  try {
    const response = await fetchSafeUrl('https://rebind.example/', { requester: fakeRequester })
    assert.equal(response.status, 200)
    assert.deepEqual(pinned, ['93.184.216.34', '93.184.216.34'])
    assert.equal(lookupCount, 1)
  } finally { dns.promises.lookup = originalLookup }
})

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

test('web_extract blocks redirects to loopback before making a second request', async () => {
  registerBuiltinTools(null, null, null, async () => '', false)
  let requests = 0
  const httpRequester = (url, options, onResponse) => {
    const request = new EventEmitter()
    request.setTimeout = () => request
    request.end = () => {
      requests++
      options.lookup(url.hostname, {}, () => onResponse({
        statusCode: 302, statusMessage: 'Found', headers: { location: 'http://127.0.0.1/' },
        resume() {}, async *[Symbol.asyncIterator]() {}
      }))
    }
    return request
  }
  const result = JSON.parse(await registry.execute('web_extract', { urls: ['https://93.184.216.34/'] }, { httpRequester }))
  assert.equal(requests, 1)
  assert.match(result.results[0].error, /Private IP/)
})