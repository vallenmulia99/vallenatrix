import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VerificationLedger, isVerificationCommand } from '../dist/verification.js'

test('verification: only real test/build/lint commands count as evidence', () => {
  for (const cmd of [
    'npm test',
    'npm -w vallenagent test',
    'npm run typecheck',
    'npm run build',
    'node --test tests/*.test.mjs',
    'pytest -q',
    'cargo test',
    'go test ./...',
    'tsc --noEmit',
    'npx eslint src'
  ]) assert.equal(isVerificationCommand(cmd), true, cmd)

  for (const cmd of [
    'ls -la',
    'cat package.json',
    'git status --short',
    'git diff --stat',
    'grep -rn foo src',
    'pwd',
    'echo hello'
  ]) assert.equal(isVerificationCommand(cmd), false, cmd)
})

test('verification: records results, extracts test counts, persists per session', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-verify-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const ledger = new VerificationLedger('session-a', dir)
  ledger.record('npm test', 0, '# tests 12\n# pass 12\n# fail 0\n')
  ledger.record('ls -la', 0, 'not evidence')
  assert.equal(ledger.count, 1, 'read-only command must not be recorded')

  const block = ledger.formatForInjection()
  assert.match(block, /\[Verification Evidence\]/)
  assert.match(block, /12\/12 pass, 0 fail/)
  assert.match(block, /1 perintah verifikasi tercatat/)

  // Persisted: a new ledger for the same session reads the same evidence back.
  const reopened = new VerificationLedger('session-a', dir)
  assert.equal(reopened.count, 1)
  assert.equal(reopened.entriesSnapshot[0].command, 'npm test')

  // A different session starts empty (files are written lazily, on first evidence).
  const other = new VerificationLedger('session-b', dir)
  assert.equal(other.count, 0)
  assert.equal(readdirSync(dir).length, 1)
})

test('verification: failing run is reported and blocks the "done" claim', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-verify-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const ledger = new VerificationLedger('session-fail', dir)
  ledger.record('npm test', 1, '# tests 12\n# pass 10\n# fail 2\n')
  const block = ledger.formatForInjection()
  assert.match(block, /10\/12 pass, 2 fail/)
  assert.match(block, /GAGAL/)
  assert.match(block, /perbaiki dulu/i)
})

test('verification: nudge fires once, only after edits and without evidence', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-verify-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const ledger = new VerificationLedger('session-nudge', dir)
  assert.equal(ledger.shouldNudge(false), false, 'no edits yet')
  assert.equal(ledger.shouldNudge(true), true, 'edits without evidence')
  assert.equal(ledger.shouldNudge(true), false, 'nudge only once')

  const withEvidence = new VerificationLedger('session-has-evidence', dir)
  withEvidence.record('npm test', 0, '# tests 1\n# pass 1\n# fail 0\n')
  assert.equal(withEvidence.shouldNudge(true), false, 'evidence already exists')
})

test('verification: no dir means memory-only, never throws', () => {
  const ledger = new VerificationLedger('session-mem')
  ledger.record('npm run build', 0, 'build ok')
  assert.equal(ledger.count, 1)
  assert.match(ledger.formatForInjection(), /build ok/)
})

test('verification: TypeScript edits require successful typecheck even when other evidence exists', () => {
  const ledger = new VerificationLedger('session-ts')
  ledger.record('npm test', 0, 'tests pass')
  ledger.beginTurn()
  assert.equal(ledger.shouldNudge(true, true), true)
  ledger.record('npm -w vallenagent run typecheck', 0, 'tsc clean')
  ledger.beginTurn()
  assert.equal(ledger.shouldNudge(true, true), true)
  ledger.record('npm -w vallenagent run typecheck', 0, 'tsc clean')
  assert.equal(ledger.shouldNudge(true, true, true), false)
})

test('verification: empty ledger injects nothing', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vallen-verify-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ledger = new VerificationLedger('session-empty', dir)
  assert.equal(ledger.formatForInjection(), null)
  assert.equal(existsSync(join(dir, 'verification-missing.json')), false)
})
