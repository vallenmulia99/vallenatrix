import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname
const out = spawnSync('npx', ['tsc', '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop', '--outDir', '/tmp/vallenatrix-m9-test', 'src/main/media.ts', 'src/shared/types.ts'], { cwd: root, encoding: 'utf8' })
if (out.status !== 0) throw new Error(out.stderr || out.stdout)
const mediaSource = await import('node:fs').then(({ readFileSync }) => readFileSync('/tmp/vallenatrix-m9-test/main/media.js', 'utf8'))
const Module = await import('node:module')
const testModule = new Module.default('/tmp/vallenatrix-m9-test/main/media.js')
testModule.require = (name) => name === 'electron' ? { dialog: {}, protocol: {}, net: {} } : Module.createRequire('/tmp/vallenatrix-m9-test/main/media.js')(name)
testModule._compile(mediaSource, '/tmp/vallenatrix-m9-test/main/media.js')
const { isAllowedMediaFile } = testModule.exports

// Electron unavailable in headless tests; stub unused module APIs.


test('M9 media validation requires matching magic bytes and rejects symlinks', () => {
  const dir = mkdtempSync(join(root, '.m9-media-'))
  try {
    const fake = join(dir, 'fake.png')
    const image = join(dir, 'image.png')
    const link = join(dir, 'link.png')
    writeFileSync(fake, 'not an image')
    writeFileSync(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    symlinkSync(image, link)
    assert.equal(isAllowedMediaFile(fake).valid, false)
    assert.deepEqual(isAllowedMediaFile(image), { valid: true, type: 'image' })
    assert.equal(isAllowedMediaFile(link).valid, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('M9 source guards validate resize payload and avoid stale PTY exit callbacks', async () => {
  const { readFileSync } = await import('node:fs')
  const index = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const pty = readFileSync(new URL('../src/main/pty.ts', import.meta.url), 'utf8')
  const config = readFileSync(new URL('../src/main/config.ts', import.meta.url), 'utf8')
  assert.match(index, /size\?\.cols/)
  assert.match(index, /Number\.isFinite\(cols\).*Number\.isFinite\(rows\)/s)
  assert.match(pty, /if \(this\.ptyProcess !== child\) return/)
  assert.match(pty, /key !== 'LIBVA_DRIVER_NAME'/)
  assert.match(config, /throw new Error\(`Failed to save config:/)
  assert.match(config, /return sanitizeConfig\(DEFAULT_CONFIG\)/)
})
