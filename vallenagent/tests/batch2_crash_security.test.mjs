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
    text: async () => '<html></html>', 
    json: async () => ({}) 
  })

  try {
    // Call tools that used to set TLS_REJECT
    await registry.execute('web_search', { query: 'test' })
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined)

    await registry.execute('web_extract', { urls: ['https://example.com'] })
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined)
  } finally {
    global.fetch = originalFetch
  }
})
