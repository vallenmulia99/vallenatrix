import test from 'node:test'
import assert from 'node:assert/strict'
import { compactHistory } from '../dist/agent.js'

test('repeated compaction preserves prior summary details beyond 120 characters', () => {
  const history = [{ role: 'system', content: 'system' }, { role: 'user', content: 'original task' }]
  for (let i = 0; i < 20; i++) history.push({ role: 'assistant', content: `step ${i}` })
  compactHistory(history, 8)
  const firstSummary = history.find(message => message.role === 'user' && message.content.startsWith('[Previous conversation summary'))
  firstSummary.content += '\nCritical file: src/security/telegram.ts; keep this exact detail.'
  for (let i = 0; i < 20; i++) history.push({ role: 'assistant', content: `later step ${i}` })
  compactHistory(history, 8)
  const summaries = history.filter(message => message.role === 'user' && message.content.startsWith('[Previous conversation summary'))
  assert.ok(summaries.some(message => message.content.includes('src/security/telegram.ts; keep this exact detail.')))
})
