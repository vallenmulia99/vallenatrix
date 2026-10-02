import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registry } from '../dist/tools.js'
import { AIAgent } from '../dist/agent.js'

test('vision_analyze tool registration and schema', (t) => {
  const agent = new AIAgent()
  const tool = registry.get('vision_analyze')
  assert.ok(tool, 'vision_analyze must be registered in ToolRegistry')
  assert.equal(tool.toolset, 'vision')
  assert.ok(tool.schema.parameters.properties.image_url)
  assert.ok(tool.schema.parameters.properties.question)
  assert.deepEqual(tool.schema.parameters.required, ['image_url', 'question'])
})

test('vision_analyze validation and file resolution', async (t) => {
  // Missing image_url
  const errNoUrl = await registry.execute('vision_analyze', { image_url: '', question: 'what is this?' })
  assert.ok(JSON.parse(errNoUrl).error.includes('image_url parameter is required'))

  // Missing local file
  const errNotFound = await registry.execute('vision_analyze', { image_url: '/tmp/nonexistent-image-12345.png', question: 'check' })
  assert.ok(JSON.parse(errNotFound).error.includes('not found'))
})

test('read_file directs user to vision_analyze when image file is opened', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'vallen-vision-test-'))
  try {
    const pngPath = join(tmp, 'test.png')
    // Real PNG header with binary 0
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00])
    writeFileSync(pngPath, fakePng)

    const res = await registry.execute('read_file', { path: pngPath })
    const parsed = JSON.parse(res)
    assert.ok(parsed.error.includes('Image file detected'))
    assert.ok(parsed.hint.includes('vision_analyze'))
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  }
})

test('vision_analyze sends multimodal payload to endpoint', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'vallen-vision-mock-'))
  const pngPath = join(tmp, 'sample.png')
  writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]))

  // Mock global fetch to intercept vision request
  const originalFetch = globalThis.fetch
  let capturedBody = null

  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/chat/completions')) {
      capturedBody = JSON.parse(opts.body)
      const jsonResponse = {
        choices: [{
          message: { role: 'assistant', content: 'This is a sample PNG image.' }
        }]
      }
      return {
        ok: true,
        json: async () => jsonResponse,
        text: async () => JSON.stringify(jsonResponse)
      }
    }
    return originalFetch(url, opts)
  }

  try {
    const res = await registry.execute('vision_analyze', {
      image_url: pngPath,
      question: 'What is shown in this picture?'
    })
    const parsed = JSON.parse(res)
    assert.ok(parsed.analysis.includes('This is a sample PNG image'))
    assert.ok(capturedBody)
    const userMsg = capturedBody.messages[0]
    assert.equal(userMsg.role, 'user')
    assert.equal(Array.isArray(userMsg.content), true)
    const textPart = userMsg.content.find(c => c.type === 'text')
    const imgPart = userMsg.content.find(c => c.type === 'image_url')
    assert.ok(textPart)
    assert.ok(imgPart)
    assert.ok(imgPart.image_url.url.startsWith('data:image/png;base64,'))
  } finally {
    globalThis.fetch = originalFetch
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  }
})
