import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const probe = `const { logger } = require('./dist/logger.js'); logger.debug('debug'); logger.info('info'); logger.warn('warn'); logger.error('error')`

for (const [level, visible] of [
  ['', ['warn', 'error']],
  ['info', ['info', 'warn', 'error']],
  ['debug', ['debug', 'info', 'warn', 'error']]
]) {
  test(`logger honors ${level || 'default warn'} threshold`, () => {
    const result = spawnSync(process.execPath, ['-e', probe], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, VALLENATRIX_LOG: level }
    })
    assert.equal(result.status, 0, result.stderr)
    const output = result.stdout + result.stderr
    for (const label of ['debug', 'info', 'warn', 'error']) {
      assert.equal(output.includes(label), visible.includes(label), `${label} visibility at ${level || 'default'}`)
    }
  })
}
