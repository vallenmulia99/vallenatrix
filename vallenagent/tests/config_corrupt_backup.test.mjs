import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setProviderToken } from '../dist/config.js'

test('corrupt config is quarantined without replacing good backup or writing defaults', t => {
  const home = mkdtempSync(join(tmpdir(), 'corrupt-config-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  mkdirSync(home, { recursive: true })
  const config = join(home, 'config.json')
  const backup = join(home, 'config.json.bak')
  writeFileSync(config, '{ broken json', { mode: 0o600 })
  writeFileSync(backup, '{"known":"good backup"}', { mode: 0o600 })
  assert.throws(() => setProviderToken('provider', 'unused'))
  assert.equal(readFileSync(backup, 'utf8'), '{"known":"good backup"}')
  const corruptName = readdirSync(home).find(name => name.startsWith('config.json.corrupt-'))
  assert.ok(corruptName)
  assert.equal(readFileSync(join(home, corruptName), 'utf8'), '{ broken json')
  assert.equal(readdirSync(home).includes('config.json'), false)
})
