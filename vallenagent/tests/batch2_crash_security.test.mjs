import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { MemoryStore } from '../dist/memory.js'
import { TodoStore } from '../dist/todo.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

test('BUG-04: read_file rejects files > 10 MB', async (t) => {
  const testDir = mkdtempSync(join(tmpdir(), 'batch2-'))
  const loader = new SkillLoader([testDir])
  loader.load()
  const memory = new MemoryStore(join(testDir, 'mem'))
  const todo = new TodoStore()
  registerBuiltinTools(loader, memory, todo, async (g) => `Sub: ${g}`, false)

  // Create 11 MB file
  const bigFile = join(testDir, 'big.txt')
  const chunk = 'x'.repeat(1024 * 1024) // 1 MB
  writeFileSync(bigFile, chunk.repeat(11))

  const result = await registry.execute('read_file', { path: bigFile })
  const parsed = JSON.parse(result)
  
  assert.ok(parsed.error)
  assert.ok(parsed.error.includes('too large'))
})

test('BUG-04: read_file rejects binary files', async (t) => {
  const testDir = mkdtempSync(join(tmpdir(), 'batch2-'))
  const loader = new SkillLoader([testDir])
  loader.load()
  const memory = new MemoryStore(join(testDir, 'mem'))
  const todo = new TodoStore()
  registerBuiltinTools(loader, memory, todo, async (g) => `Sub: ${g}`, false)

  const binFile = join(testDir, 'bin.dat')
  const buf = Buffer.alloc(100)
  buf[50] = 0 // null byte
  writeFileSync(binFile, buf)

  const result = await registry.execute('read_file', { path: binFile })
  const parsed = JSON.parse(result)
  
  assert.ok(parsed.error)
  assert.ok(parsed.error.includes('Binary'))
})

test('web_extract blocks bracketed IPv6 loopback before fetch', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'batch2-'))
  const loader = new SkillLoader([testDir])
  loader.load()
  registerBuiltinTools(loader, new MemoryStore(join(testDir, 'mem')), new TodoStore(), async () => '', false)
  const originalFetch = global.fetch
  let called = false
  global.fetch = async () => { called = true; return { ok: true, text: async () => '<html></html>' } }
  try {
    const result = JSON.parse(await registry.execute('web_extract', { urls: ['http://[::1]/', 'http://[::ffff:127.0.0.1]/'] }))
    assert.ok(result.results.every(item => /Private IP/.test(item.error)))
    assert.equal(called, false)
  } finally {
    global.fetch = originalFetch
  }
})

test('web_extract blocks redirects to loopback', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'batch2-'))
  const loader = new SkillLoader([testDir])
  loader.load()
  registerBuiltinTools(loader, new MemoryStore(join(testDir, 'mem')), new TodoStore(), async () => '', false)
  const originalFetch = global.fetch
  let fetchCount = 0
  global.fetch = async () => {
    fetchCount++
    return { status: 302, ok: false, headers: new Headers({ location: 'http://127.0.0.1/' }), text: async () => '' }
  }
  try {
    const result = JSON.parse(await registry.execute('web_extract', { urls: ['http://8.8.8.8/'] }))
    assert.match(result.results[0].error, /Private IP/)
    assert.equal(fetchCount, 1)
  } finally {
    global.fetch = originalFetch
  }
})

test('BUG-05: NODE_TLS_REJECT_UNAUTHORIZED not set after tools', async (t) => {
  const testDir = mkdtempSync(join(tmpdir(), 'batch2-'))
  const loader = new SkillLoader([testDir])
  loader.load()
  const memory = new MemoryStore(join(testDir, 'mem'))
  const todo = new TodoStore()
  registerBuiltinTools(loader, memory, todo, async (g) => `Sub: ${g}`, false)

  // Mock fetch to avoid network
  const originalFetch = global.fetch
  global.fetch = async () => ({ 
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => '<html></html>', 
    json: async () => ({}) 
  })

  try {
    // Call tools that used to set TLS_REJECT
    await registry.execute('web_search', { query: 'test' })
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined)

    await registry.execute('web_extract', { urls: ['https://8.8.8.8'] })
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined)
  } finally {
    global.fetch = originalFetch
  }
})
