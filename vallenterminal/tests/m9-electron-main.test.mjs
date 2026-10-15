import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname
const out = spawnSync('npx', ['tsc', '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop', '--outDir', '/tmp/vallenatrix-m9-test', 'src/main/media.ts', 'src/shared/types.ts'], { cwd: root, encoding: 'utf8' })
if (out.status !== 0) throw new Error(out.stderr || out.stdout)
const mediaSource = await import('node:fs').then(({ readFileSync }) => readFileSync('/tmp/vallenatrix-m9-test/main/media.js', 'utf8'))
const Module = await import('node:module')
let protocolHandler
let receivedRange
const electronStub = {
  dialog: {},
  protocol: { handle: (_scheme, handler) => { protocolHandler = handler } },
  net: { fetch: async (_url, options) => { receivedRange = options.headers.get('range'); return new Response('partial', { status: 206 }) } }
}
const testModule = new Module.default('/tmp/vallenatrix-m9-test/main/media.js')
testModule.require = (name) => name === 'electron' ? electronStub : Module.createRequire('/tmp/vallenatrix-m9-test/main/media.js')(name)
testModule._compile(mediaSource, '/tmp/vallenatrix-m9-test/main/media.js')
const { isAllowedMediaFile, registerMediaProtocol } = testModule.exports

// Electron unavailable in headless tests; stub unused module APIs.


test('media validation requires magic bytes and accepts safe symlinks', () => {
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
    assert.deepEqual(isAllowedMediaFile(link), { valid: true, type: 'image' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('media protocol forwards Range request headers for video seeking', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'm9-media-range-'))
  try {
    const video = join(dir, 'sample.mp4')
    writeFileSync(video, Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]))
    registerMediaProtocol()
    const response = await protocolHandler({
      url: `vallen-media://local${encodeURI(video)}`,
      headers: new Headers({ range: 'bytes=0-7' })
    })
    assert.equal(response.status, 206)
    assert.equal(receivedRange, 'bytes=0-7')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('M9 source guards validate resize payload and avoid stale PTY exit callbacks', async () => {
  const { readFileSync } = await import('node:fs')
  const index = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const pty = readFileSync(new URL('../src/main/pty.ts', import.meta.url), 'utf8')
  const config = readFileSync(new URL('../src/main/config.ts', import.meta.url), 'utf8')
  assert.match(index, /size\?\.cols/)
  assert.match(index, /Number\.isFinite\(cols\).*Number\.isFinite\(rows\)/s)
  const ptyExitHandler = index.slice(index.indexOf('function startPtyShell'), index.indexOf('// Register IPC handlers'))
  assert.match(ptyExitHandler, /IPC_CHANNELS\.TERMINAL_EXIT/)
  assert.doesNotMatch(ptyExitHandler, /mainWindow\.close\(/)
  assert.match(index, /cmd === '\/stop'[\s\S]*agent\.interrupt\(\)/)
  assert.match(pty, /if \(this\.ptyProcess !== child\) return/)
  assert.match(pty, /key !== 'LIBVA_DRIVER_NAME'/)
  assert.match(config, /throw new Error\(`Failed to save config:/)
  assert.match(config, /return sanitizeConfig\(DEFAULT_CONFIG\)/)
  assert.match(readFileSync(new URL('../src/main/media.ts', import.meta.url), 'utf8'), /headers: request\.headers/)
  assert.match(readFileSync(new URL('../src/main/media.ts', import.meta.url), 'utf8'), /realpathSync\(filePath\)/)
})

test('Electron and terminal titlebar use Vallenatrix branding and icon', async () => {
  const { readFileSync } = await import('node:fs')
  const index = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.match(index, /app\.setName\('Vallenatrix'\)/)
  assert.match(index, /icon: join\(__dirname, '\.\.\/\.\.\/assets\/vallenatrix\.png'\)/)
  assert.match(html, /src="\.\.\/\.\.\/assets\/vallenatrix\.png"/)
  assert.match(html, /<span class="titlebar-title">Vallenatrix<\/span>/)
  assert.match(html, /<title>Vallenatrix<\/title>/)
})
