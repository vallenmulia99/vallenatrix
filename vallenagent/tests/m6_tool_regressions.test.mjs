import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { MemoryStore } from '../dist/memory.js'
import { TodoStore } from '../dist/todo.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'
import { EventEmitter } from 'node:events'

const httpRequester = (_url, _options, callback) => {
  const request = new EventEmitter()
  request.setTimeout = () => request
  request.end = () => callback({ statusCode: 200, statusMessage: 'OK', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from('<p>&amp;lt;b&amp;gt;</p>') } })
  return request
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'm6-'))
  const loader = new SkillLoader([dir]); loader.load()
  registerBuiltinTools(loader, new MemoryStore(join(dir, 'mem')), new TodoStore(), async () => '', false)
  return dir
}

test('read_file clamps negative line limit to zero', async () => {
  const dir = setup(); const file = join(dir, 'lines.txt'); writeFileSync(file, 'one\ntwo')
  const result = JSON.parse(await registry.execute('read_file', { path: file, limit: -1 }))
  assert.equal(result.limit, 0)
  assert.equal(result.content, '')
})

test('search_files stops traversal at result limit', async () => {
  const dir = setup(); const a = join(dir, 'a.txt'), b = join(dir, 'b.txt')
  writeFileSync(a, 'hit'); writeFileSync(b, 'hit')
  const result = JSON.parse(await registry.execute('search_files', { path: dir, pattern: 'hit', limit: 1 }))
  assert.equal(result.matches.length, 1)
  assert.equal(result.total_count, 1)
  assert.equal(result.truncated, false)
})

test('web_extract decodes HTML entities once', async () => {
  const dir = setup()
  try {
    const result = JSON.parse(await registry.execute('web_extract', { urls: ['https://93.184.216.34/'] }, { httpRequester }))
    assert.match(result.results[0].content, /&lt;b&gt;/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('image_generate rejects non-image response without writing file', async () => {
  const dir = setup(), originalFetch = global.fetch, output = join(dir, 'bad.png')
  global.fetch = async () => new Response('<html>error</html>', { status: 200, headers: { 'content-type': 'text/html' } })
  try {
    const result = JSON.parse(await registry.execute('image_generate', { prompt: 'test', output_path: output }))
    assert.match(result.error, /not a supported image/)
    assert.equal(existsSync(output), false)
  } finally { global.fetch = originalFetch; rmSync(dir, { recursive: true, force: true }) }
})
