import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { registerBuiltinTools, isPrivateAddress, fuzzyReplace, unescapeString } from '../dist/builtin_tools.js'

registerBuiltinTools(null, null, null, async () => '', false)
const temp = () => mkdtempSync(join(tmpdir(), 'builtin-plan-'))

test('BUG-03 fuzzy replacements preserve indentation and replace all unicode-normalized matches', () => {
  const src = 'def f():\n        if x:\n            return 1\n'
  assert.match(fuzzyReplace(src, 'if x:\n    return 1', 'if y:\n    return 2').content, /        if y:\n            return 2/)
  assert.equal(fuzzyReplace('“x”\n“x”', '"x"', 'y', true).content, 'y\ny')
  const diff = fuzzyReplace('before\nold\nafter', 'old', 'new').diff
  assert.match(diff, /@@ -1,1 \+1,1 @@/)
  assert.match(diff, /\n-old\n\+new/)
})

test('P2 execute_code stages oversized source and browser_exec rejects unsupported sessions', async () => {
  const large = JSON.parse(await registry.execute('execute_code', { code: `#${'x'.repeat(110_000)}\nprint('ok')`, timeout_s: 10 }))
  assert.equal(large.exit_code, 0)
  assert.equal(large.stdout, 'ok')
  const output = JSON.parse(await registry.execute('execute_code', { code: "print('🙂' * 20000)" }))
  assert.equal(output.truncated, true)
  assert.equal(output.stdout.includes('�'), false)
  const session = JSON.parse(await registry.execute('browser_exec', { code: 'print(1)', session: 'named' }))
  assert.match(session.error, /not supported/)
})

test('P2 web_search decodes HTML and malformed redirect escapes safely', async () => {
  const dns = await import('node:dns')
  const { EventEmitter } = await import('node:events')
  const originalLookup = dns.default.promises.lookup
  dns.default.promises.lookup = async () => [{ address: '93.184.216.34', family: 4 }]
  const httpRequester = (_url, _options, callback) => {
    const request = new EventEmitter()
    request.setTimeout = () => request
    request.end = () => callback({ statusCode: 200, statusMessage: 'OK', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from('<a class="result__a" href="https://example.com">Tom &amp; Jerry</a><a class="result__snippet" href="//duckduckgo.com/?uddg=https%3A%2F%2Fexample.com%2F%25">A &amp; B</a>') } })
    return request
  }
  try {
    const result = JSON.parse(await registry.execute('web_search', { query: 'test' }, { httpRequester }))
    assert.equal(result.data.web[0].title, 'Tom & Jerry')
    assert.equal(result.data.web[0].description, 'A & B')
    assert.match(result.data.web[0].url, /%$/)
  } finally { dns.default.promises.lookup = originalLookup }
})

test('P2 image_generate applies 4:3 and matches generated extension', async (t) => {
  const root = temp()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const original = globalThis.fetch
  let requestedUrl = ''
  globalThis.fetch = async url => {
    requestedUrl = String(url)
    return new Response(Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))
  }
  try {
    const result = JSON.parse(await registry.execute('image_generate', { prompt: 'test', aspect_ratio: '4:3', output_path: join(root, 'image.png') }, { workingDir: root }))
    assert.match(requestedUrl, /width=1024&height=768/)
    assert.equal(result.path, join(root, 'image.webp'))
  } finally { globalThis.fetch = original }
})

test('P2 clarify and connection tools report runtime limitations honestly', async () => {
  const clarify = JSON.parse(await registry.execute('clarify', { questions: [{ question: 'Pick?' }] }))
  assert.match(clarify.message, /cannot collect structured/)
  const connections = JSON.parse(await registry.execute('manage_connections', {}))
  assert.equal(connections.supported, false)
  assert.equal('9router' in (connections.connectors || {}), false)
})

test('BUG-07 blocks special IPv4 and IPv6 ranges', () => {
  for (const ip of ['fd12:3456:789a:1::5f2a:91c3', 'fc00::abcd:1234', '64:ff9b::7f00:1', '::7f00:1', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255']) assert.equal(isPrivateAddress(ip), true, ip)
})

test('BUG-07 vision blocks redirect to loopback before a second request', async () => {
  const { EventEmitter } = await import('node:events')
  let calls = 0
  const httpRequester = (url, options, callback) => {
    const request = new EventEmitter()
    request.setTimeout = () => request
    request.end = () => {
      calls++
      options.lookup(url.hostname, {}, () => callback({ statusCode: 302, statusMessage: 'Found', headers: { location: 'http://127.0.0.1/image' }, resume() {}, async *[Symbol.asyncIterator]() {} }))
    }
    return request
  }
  const result = JSON.parse(await registry.execute('vision_analyze', { image_url: 'https://93.184.216.34/image', question: 'x' }, { httpRequester }))
  assert.match(result.error, /Private IP/)
  assert.equal(calls, 1)
})

test('BUG-10 terminal resolves relative workdir against session, preserves cwd, and returns for background job', async () => {
  const root = temp(); mkdirSync(join(root, 'sub'))
  const context = { workingDir: root }
  const run = (args) => registry.execute('terminal', args, context)
  assert.equal(JSON.parse(await run({ command: 'pwd', workdir: 'sub' })).exit_code, 0)
  assert.equal(context.workingDir, root)
  const start = Date.now()
  const result = JSON.parse(await run({ command: 'sleep 2 &', timeout: 4 }))
  assert.ok(Date.now() - start < 1000)
  assert.equal(result.timed_out, undefined)
  rmSync(root, { recursive: true, force: true })
})

test('BUG-11 search_files reports truncation after limit', async () => {
  const root = temp()
  for (let i = 0; i < 10; i++) writeFileSync(join(root, `match-${i}.txt`), 'needle\n')
  const result = JSON.parse(await registry.execute('search_files', { target: 'files', pattern: '*.txt', path: root, limit: 3 }))
  assert.equal(result.files.length, 3)
  assert.equal(result.truncated, true)
  rmSync(root, { recursive: true, force: true })
})

test('BUG-12 write_file preserves symlink; patch rejects binary and writes atomically', async () => {
  const root = temp(), real = join(root, 'real.txt'), link = join(root, 'link.txt')
  writeFileSync(real, 'old'); symlinkSync(real, link)
  const context = { workingDir: root, fileReadCoverage: new Map() }
  await registry.execute('read_file', { path: link }, context)
  await registry.execute('write_file', { path: link, content: 'new' }, context)
  assert.equal(lstatSync(link).isSymbolicLink(), true)
  assert.equal(readFileSync(real, 'utf8'), 'new')
  const binary = join(root, 'binary'); writeFileSync(binary, Buffer.from([0x61, 0, 0x62]))
  const result = JSON.parse(await registry.execute('patch', { path: binary, old_string: 'a', new_string: 'b' }, { workingDir: root }))
  assert.ok(result.error)
  rmSync(root, { recursive: true, force: true })
})

test('BUG-13 web_extract clamps negative char_limit and parses multiline tags', async () => {
  const { EventEmitter } = await import('node:events')
  const httpRequester = (_url, _options, callback) => {
    const request = new EventEmitter()
    request.setTimeout = () => request
    request.end = () => callback({ statusCode: 200, statusMessage: 'OK', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from('<h1>first\nsecond</h1><p>body\nline</p>') } })
    return request
  }
  const result = JSON.parse(await registry.execute('web_extract', { urls: ['https://93.184.216.34/'], char_limit: -1 }, { httpRequester }))
  assert.doesNotMatch(result.results[0].content, /undefined/)
  assert.match(result.results[0].content, /first\nsecond/)
})

test('BUG-14 skill_manage rolls back earlier batch changes after later failure', async () => {
  const root = temp()
  const loader = { skillPaths: [root], get: () => null, load() { this.loaded = true } }
  try {
    const result = JSON.parse(await registry.execute('skill_manage', { operations: [
      { action: 'create', name: 'created', content: '# created' },
      { action: 'patch', name: 'missing', old_string: 'x', new_string: 'y' }
    ] }, { workingDir: root, stores: { skillLoader: loader } }))
    assert.equal(result.success, false)
    assert.equal(result.results?.length, 2)
    assert.equal(result.results[0].status, 'rolled_back')
    assert.equal(result.results[1].status, 'error')
    assert.match(result.error, /not found for patch/)
    assert.equal(existsSync(join(root, 'custom', 'created')), false)
    assert.equal(loader.loaded, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('P2 unescape preserves literal backslash before n', () => {
  assert.equal(unescapeString('a\\\\nb'), 'a\\nb')
})
