import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('PTY ignores data emitted by replaced child', () => {
  const source = readFileSync(join(root, 'src/main/pty.ts'), 'utf8')
  assert.match(source, /child\.onData\(\(data\) => \{\s*if \(this\.ptyProcess !== child\) return/)
})

test('/cd expands home shorthand before resolving path', () => {
  const source = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
  assert.match(source, /requestedPath\.startsWith\('~\/'\)/)
})

test('/cd cwd override survives an active agent tool completing later', () => {
  const source = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
  assert.match(source, /terminalRuntime\.cwdRevision\+\+/)
  assert.match(source, /cwdRevision !== cwdRevisionAtStart[\s\S]*?agent\.config\.terminal\.cwd = terminalRuntime\.cwdOverride/)
})
