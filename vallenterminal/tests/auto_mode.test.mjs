import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
const renderer = readFileSync(join(root, 'src/renderer/main.ts'), 'utf8')

test('/auto on skips every approval; safe keeps dangerous tools gated; off asks for every tool', () => {
  const start = main.indexOf("if (cmd === '/auto')")
  const end = main.indexOf("if (cmd === '/session')", start)
  const command = main.slice(start, end)
  assert.match(command, /agentApproval: 'off'/)
  assert.match(command, /agentApproval: 'dangerous'/)
  assert.match(command, /agentApproval: 'all'/)
  assert.match(command, /termasuk command berisiko dan operasi destruktif/)
  assert.match(command, /setting === 'safe'/)
  assert.match(main, /requiresApproval\(\{ name: info.name, args: info.args \}, mode\)/)
  assert.match(renderer, /cmd: '\/auto'/)
})
