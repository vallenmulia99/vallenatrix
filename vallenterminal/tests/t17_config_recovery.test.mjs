import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/main/config.ts', import.meta.url), 'utf8')

test('config preserves parse failures and writes config/themes atomically', () => {
  assert.ok(source.includes('.corrupt-${Date.now()}'))
  assert.match(source, /renameSync\(this\.configPath, backupPath\)/)
  assert.match(source, /private writeAtomic\(/)
  assert.match(source, /this\.writeAtomic\(this\.configPath/)
  assert.match(source, /this\.writeAtomic\(dest/)
})

test('theme containment uses path-relative boundary checks', () => {
  assert.match(source, /relative\(resolve\(base\), resolve\(target\)\)/)
  assert.match(source, /!rel\.startsWith\('\.\.'\) && !isAbsolute\(rel\)/)
  assert.match(source, /!app\.isPackaged/)
})
