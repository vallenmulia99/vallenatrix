import test from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig, saveConfig, setProviderToken } from '../dist/config.js'
import { formatToolStart, formatToolEnd, formatUnifiedDiff, formatResponseBox } from '../dist/display.js'
import { AIAgent } from '../dist/agent.js'

test('Display & Pretty Printing - Hermes Style', (t) => {
  // Test formatToolStart: "  ┊ 📖 preparing read_file…"
  const startRead = formatToolStart('read_file', { path: 'src/main.ts', offset: 1, limit: 50 })
  assert.ok(startRead.includes('┊'))
  assert.ok(startRead.includes('📖'))
  assert.ok(startRead.includes('preparing read_file…'))

  const startPatch = formatToolStart('patch', { path: 'src/index.ts' })
  assert.ok(startPatch.includes('┊'))
  assert.ok(startPatch.includes('🔧'))
  assert.ok(startPatch.includes('preparing patch…'))

  const startTerm = formatToolStart('terminal', { command: 'npm test' })
  assert.ok(startTerm.includes('┊'))
  assert.ok(startTerm.includes('💻'))
  assert.ok(startTerm.includes('preparing terminal…'))

  // Test formatUnifiedDiff with - red and + green
  const rawDiff = '--- a/foo.ts\n+++ b/foo.ts\n@@ -1,3 +1,3 @@\n-old line\n+new line\n context'
  const rendered = formatUnifiedDiff(rawDiff)
  assert.ok(rendered.includes('\x1b[31m-old line'))
  assert.ok(rendered.includes('\x1b[32m+new line'))

  // Test formatToolEnd for patch: "  ┊ 🔧 patch     foo.ts  1.2s\n  ┊ review diff\n..."
  const patchRes = JSON.stringify({ success: true, diff: rawDiff, strategy: 'exact' })
  const endPatch = formatToolEnd('patch', { path: 'foo.ts' }, patchRes, 1.2)
  assert.ok(endPatch.includes('┊'))
  assert.ok(endPatch.includes('🔧'))
  assert.ok(endPatch.includes('patch'))
  assert.ok(endPatch.includes('foo.ts'))
  assert.ok(endPatch.includes('1.2s'))
  assert.ok(endPatch.includes('review diff'))
  assert.ok(endPatch.includes('\x1b[31m-old line'))
  assert.ok(endPatch.includes('\x1b[32m+new line'))

  // Test formatToolEnd for read_file: "  ┊ 📖 read      foo.ts L1-10  0.1s"
  const readRes = JSON.stringify({ total_lines: 10, content: '1|line1\n2|line2' })
  const endRead = formatToolEnd('read_file', { path: 'foo.ts', offset: 1, limit: 10 }, readRes, 0.1)
  assert.ok(endRead.includes('┊'))
  assert.ok(endRead.includes('📖'))
  assert.ok(endRead.includes('read'))
  assert.ok(endRead.includes('foo.ts'))
  assert.ok(endRead.includes('L1-10'))
  assert.ok(endRead.includes('0.1s'))

  // Test formatToolEnd for terminal: "  ┊ 💻 $         npm test  36.9s"
  const termRes = JSON.stringify({ exit_code: 0, output: 'all green' })
  const endTerm = formatToolEnd('terminal', { command: 'npm test' }, termRes, 36.9)
  assert.ok(endTerm.includes('┊'))
  assert.ok(endTerm.includes('💻'))
  assert.ok(endTerm.includes('$'))
  assert.ok(endTerm.includes('npm test'))
  assert.ok(endTerm.includes('36.9s'))

  // Test formatResponseBox: ╭─ ☤ Vallenatrix ───╮ ... ╰───╯
  const box = formatResponseBox('All tests passed cleanly.\nReady to proceed.', ' ☤ Vallenatrix ', 60)
  assert.ok(box.includes('╭─ ☤ Vallenatrix '))
  assert.ok(box.includes('╰'))
  assert.ok(box.includes('All tests passed cleanly.'))
})

test('Token & Provider Configuration', (t) => {
  const agent = new AIAgent()
  const originalKey = agent.getConfig().providers['9router'].api_key
  
  try {
    // Set token
    agent.setToken('test-9router-token-12345', '9router')
    const cfg = agent.getConfig()
    assert.equal(cfg.providers['9router'].api_key, 'test-9router-token-12345')

    // Set model
    agent.setModel('ag/gemini-3.8-flash-medium')
    const updatedCfg = agent.getConfig()
    assert.equal(updatedCfg.providers['9router'].model, 'ag/gemini-3.8-flash-medium')
  } finally {
    if (originalKey) {
      agent.setToken(originalKey, '9router')
    }
  }
})
