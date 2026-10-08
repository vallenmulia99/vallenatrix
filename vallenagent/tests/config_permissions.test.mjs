import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveConfig } from '../dist/config.js'

test('saveConfig restricts existing config file permissions', t => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-config-perm-'))
  t.after(() => { delete process.env.VALLENATRIX_HOME; rmSync(home, { recursive: true, force: true }) })
  process.env.VALLENATRIX_HOME = home
  mkdirSync(home, { recursive: true })
  const config = join(home, 'config.json')
  writeFileSync(config, JSON.stringify({ providers: { active: '9router' } }))
  chmodSync(config, 0o644)
  saveConfig({ max_iterations: 2 })
  assert.equal(statSync(config).mode & 0o777, 0o600)
})
