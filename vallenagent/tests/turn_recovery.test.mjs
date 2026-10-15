import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  buildCheckpoint,
  buildResumePrompt,
  checkpointPath,
  clearCheckpoint,
  defaultCheckpointDir,
  isCheckpointRelevant,
  loadCheckpoint,
  progressFromHistory,
  saveCheckpoint
} from '../dist/turn_recovery.js'

test('turn_recovery: checkpoint round-trips and caps its fields', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-turn-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const checkpoint = buildCheckpoint({
    sessionId: 'session-a',
    iterations: 42,
    toolCalls: 17,
    userRequest: 'refactor the approval gate',
    filesTouched: ['a.ts', 'b.ts'],
    progress: 'Agent: started work',
    lastError: 'provider 500'
  })
  const file = saveCheckpoint(dir, checkpoint)
  assert.ok(file && existsSync(file))

  const loaded = loadCheckpoint(dir, 'session-a')
  assert.equal(loaded.iterations, 42)
  assert.equal(loaded.toolCalls, 17)
  assert.equal(loaded.userRequest, 'refactor the approval gate')
  assert.deepEqual(loaded.filesTouched, ['a.ts', 'b.ts'])
  assert.equal(loaded.lastError, 'provider 500')
  assert.equal(isCheckpointRelevant(loaded), true)

  // Long progress is truncated instead of bloating the resume prompt.
  const big = buildCheckpoint({ sessionId: 's', iterations: 1, toolCalls: 0, userRequest: 'x', progress: 'y'.repeat(9000) })
  assert.ok(big.progress.length <= 4000)
})

test('turn_recovery: resume prompt carries the goal and forbids redoing work', () => {
  const checkpoint = buildCheckpoint({
    sessionId: 'session-a',
    iterations: 12,
    toolCalls: 4,
    userRequest: 'fix the login bug',
    filesTouched: ['auth.ts'],
    progress: 'Agent: patched token check',
    lastError: 'stream idle timeout'
  })
  const prompt = buildResumePrompt(checkpoint)
  assert.match(prompt, /\[Resumed turn\]/)
  assert.match(prompt, /fix the login bug/)
  assert.match(prompt, /auth\.ts/)
  assert.match(prompt, /stream idle timeout/)
  assert.match(prompt, /Do not repeat completed steps/)
})

test('turn_recovery: stale or absent checkpoints never resume', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-turn-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.equal(loadCheckpoint(dir, 'missing'), null)
  assert.equal(isCheckpointRelevant(null), false)

  const old = buildCheckpoint({ sessionId: 'old', iterations: 1, toolCalls: 0, userRequest: 'x', progress: '' })
  old.updatedAt = Date.now() - 48 * 60 * 60 * 1000
  assert.equal(isCheckpointRelevant(old), false)
  assert.equal(isCheckpointRelevant(old, 72 * 60 * 60 * 1000), true)
})

test('turn_recovery: corrupt files and unwritable dirs degrade quietly', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-turn-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(checkpointPath(dir, 'broken'), '{not json')
  assert.equal(loadCheckpoint(dir, 'broken'), null)
  // Session ids that are not plain filenames are sanitised, never allowed to escape the dir.
  const escaped = saveCheckpoint(dir, buildCheckpoint({ sessionId: '../escape', iterations: 0, toolCalls: 0, userRequest: 'a', progress: '' }))
  assert.ok(escaped)
  assert.equal(resolve(escaped).startsWith(resolve(dir) + sep), true, `checkpoint escaped its dir: ${escaped}`)
  assert.ok(escaped.includes('escape'))
})

test('turn_recovery: clearCheckpoint empties the file so it stops resuming', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-turn-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  saveCheckpoint(dir, buildCheckpoint({ sessionId: 'done', iterations: 3, toolCalls: 1, userRequest: 'task', progress: 'p' }))
  assert.ok(loadCheckpoint(dir, 'done'))
  clearCheckpoint(dir, 'done')
  assert.equal(loadCheckpoint(dir, 'done'), null)
})

test('turn_recovery: progress summary keeps only recent tool lines', () => {
  const messages = []
  for (let i = 0; i < 60; i++) {
    messages.push({ role: 'tool', name: `tool${i}`, content: `result ${i}` })
  }
  const progress = progressFromHistory(messages, 5)
  assert.equal(progress.split('\n').length, 5)
  assert.match(progress, /tool59/)
  assert.doesNotMatch(progress, /tool1\b/)
})

test('turn_recovery: default dir is derived from the session dir', () => {
  assert.equal(defaultCheckpointDir('/tmp/sessions'), '/tmp/sessions')
  assert.ok(defaultCheckpointDir(undefined, '/tmp/home').endsWith('sessions'))
})
