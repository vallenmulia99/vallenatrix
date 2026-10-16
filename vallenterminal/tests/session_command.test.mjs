import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
const banner = readFileSync(join(root, 'src/main/banner.ts'), 'utf8')
const renderer = readFileSync(join(root, 'src/renderer/main.ts'), 'utf8')

test('/session clearall requires explicit confirm before deleting saved sessions', () => {
  const command = main.slice(main.indexOf("if (cmd === '/session')"), main.indexOf("if (cmd === '/token')"))
  assert.ok(command.indexOf("subcommand === 'clearall'") < command.indexOf("subcommand === 'clearall confirm'"))
  assert.match(command, /clearAllSessions\(\)/)
  assert.match(command, /Promise\.all\(agents\.map\(instance => instance\.resetSession\(\)\)\)/)
  assert.match(command, /clearall confirm/)
})

test('startup guide displays active session title below creator credit', () => {
  const creator = banner.indexOf("Created by ")
  const session = banner.indexOf('makeRow(sessionLabel)')
  assert.ok(creator >= 0 && session > creator)
  assert.match(banner, /const sessionLabel = ''/)
  assert.match(main, /savedSession\.id.*savedSession\.model/s)
  assert.match(main, /\$\{sessionDateText\} \|/)
  assert.match(renderer, /res\.sessionLabel && !displayedSessionLabels\.has\(requestTerminalId\)/)
  assert.match(renderer, /updateStartupSessionRow\(res\.sessionLabel\)/)
  assert.match(renderer, /Created by @vallenganteng/)
})

test('/resume without an argument and /resume latest select newest saved session', () => {
  const command = main.slice(main.indexOf("if (cmd === '/resume')"), main.indexOf("if (cmd === '/new'"))
  assert.match(command, /rest\[0\]\?\.trim\(\) \|\| 'latest'/)
  assert.match(command, /targetId\.toLowerCase\(\) === 'latest'[\s\S]*?listSessions\(\)\[0\]\?\.id/)
  assert.match(command, /agent\.resumeSession\(sessionId\)/)
  assert.match(command, /No saved sessions to resume/)
})

test('session command appears in slash autocomplete and help', () => {
  assert.match(renderer, /cmd: '\/session', desc: 'Hapus seluruh riwayat sesi \(perlu konfirmasi\)'/)
  assert.match(main, /\/session clearall - Delete all saved sessions \(requires confirm\)/)
})
