import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function runInstaller(withLockfile, choice = '1\n') {
  const fixture = mkdtempSync(join(tmpdir(), 'vallenatrix-installer-smoke-'))
  const home = join(fixture, 'home')
  const project = join(fixture, 'project')
  const fakeBin = join(fixture, 'fake-bin')
  mkdirSync(join(project, 'bin'), { recursive: true })
  mkdirSync(join(project, 'vallenterminal', 'assets'), { recursive: true })
  const routerApp = join(fixture, '9router-app')
  const routerStatic = join(routerApp, '.next-cli-build', 'static', 'chunks')
  const routerServer = join(routerApp, '.next-cli-build', 'server')
  mkdirSync(join(routerStatic, 'app', '(dashboard)', 'dashboard', 'cli-tools', '[toolId]'), { recursive: true })
  mkdirSync(routerServer, { recursive: true })
  mkdirSync(join(routerApp, 'public', 'providers'), { recursive: true })
  mkdirSync(fakeBin)
  copyFileSync(join(repoRoot, 'install.sh'), join(project, 'install.sh'))
  mkdirSync(join(project, 'setup9router'))
  copyFileSync(join(repoRoot, 'setup9router', 'install.sh'), join(project, 'setup9router', 'install.sh'))
  copyFileSync(join(repoRoot, 'setup9router', 'patch-local.js'), join(project, 'setup9router', 'patch-local.js'))
  copyFileSync(join(repoRoot, 'vallenterminal', 'assets', 'vallenatrix.png'), join(project, 'vallenterminal', 'assets', 'vallenatrix.png'))
  writeFileSync(join(routerStatic, '761-newhash.js'), 'hermes:{id:"hermes",name:"Hermes Agent"},droid:{id:"droid"}')
  writeFileSync(join(routerStatic, 'app/(dashboard)/dashboard/cli-tools/[toolId]/page-9fe240988c674585.js'), 'case"hermes":return(0,s.jsx)(n.RF,{...d,activeProviders:$(),hasActiveProviders:r,cloudEnabled:b});case"cline":')
  writeFileSync(join(routerApp, 'custom-server.js'), 'const http = require("http");\nconst path = require("path");\nconst fs = require("fs");\nconst crypto = require("crypto");\nconst { execFileSync } = require("child_process");\nconst route = (req,res) => {\n  return handler(req, res);\n};\n')
  writeFileSync(join(routerServer, 'app-paths-manifest.json'), '{}\n')
  writeFileSync(join(project, 'package.json'), '{"name":"vallenatrix"}\n')
  copyFileSync(join(repoRoot, 'vallenterminal', 'assets', 'vallenatrix.png'), join(project, 'vallenterminal', 'assets', 'vallenatrix.png'))
  writeFileSync(join(project, 'bin', 'vallenatrix'), '#!/bin/sh\nexit 0\n')
  if (withLockfile) writeFileSync(join(project, 'package-lock.json'), '{}\n')
  writeFileSync(join(fakeBin, 'node'), `#!/bin/sh\n[ "$1" = "-v" ] && { printf "v20.0.0\\n"; exit 0; }\nexec ${process.execPath} "$@"\n`)
  writeFileSync(join(fakeBin, 'npm'), '#!/bin/sh\n[ "$1" = "-v" ] && { printf "10.0.0\\n"; exit 0; }\nprintf "%s\\n" "$*" >> "$NPM_LOG"\nif { [ "$1" = install ] || [ "$1" = i ]; } && [ "$2" = -g ]; then printf "#!/bin/sh\\nexit 0\\n" > "$FAKE_BIN/9router"; chmod +x "$FAKE_BIN/9router"; fi\n')
  chmodSync(join(fakeBin, 'node'), 0o755)
  chmodSync(join(fakeBin, 'npm'), 0o755)
  const log = join(fixture, 'npm.log')
  const result = spawnSync('bash', [join(project, 'install.sh')], {
    encoding: 'utf8',
    input: choice,
    env: { ...process.env, HOME: home, PATH: `${fakeBin}:${dirname(process.execPath)}:/usr/bin:/bin`, NPM_LOG: log, FAKE_BIN: fakeBin, NINEROUTER_APP_DIR: routerApp }
  })
  const npmCalls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
  const link = join(home, '.local', 'bin', 'vallenatrix')
  const output = result.stdout + result.stderr
  const linkTarget = existsSync(link) ? readlinkSync(link) : null
  const desktop = join(home, '.local', 'share', 'applications', 'vallenatrix.desktop')
  const icon = join(home, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps', 'vallenatrix.png')
  const desktopContents = existsSync(desktop) ? readFileSync(desktop, 'utf8') : ''
  const iconExists = existsSync(icon)
  const registryPatched = readFileSync(join(routerStatic, '761-newhash.js'), 'utf8').includes('vallenatrix:{id:')
  const detailPatched = readFileSync(join(routerStatic, 'app/(dashboard)/dashboard/cli-tools/[toolId]/page-9fe240988c674585.js'), 'utf8').includes('case"vallenatrix"')
  const apiPatched = readFileSync(join(routerApp, 'custom-server.js'), 'utf8').includes('handleVallenatrixSettings')
  const iconCopied = existsSync(join(routerApp, 'public/providers/vallenatrix.png'))
  if (result.status !== 0) console.error(`installer fixture retained: ${fixture}`)
  else rmSync(fixture, { recursive: true, force: true })
  return { result, npmCalls, output, linkTarget, expectedTarget: join(project, 'bin', 'vallenatrix'), desktopContents, iconExists, registryPatched, detailPatched, apiPatched, iconCopied }
}

test('installer uses npm ci with lockfile and prints PATH guidance', () => {
  const { result, npmCalls, output, linkTarget, expectedTarget, desktopContents, iconExists } = runInstaller(true)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(npmCalls[0], 'ci')
  assert.ok(npmCalls.includes('run rebuild:pty'))
  assert.match(output, /\.local\/bin belum ada di PATH/)
  assert.match(output, /Instalasi Vallenatrix Selesai/)
  assert.equal(linkTarget, expectedTarget)
  assert.match(desktopContents, /Name=Vallenatrix/)
  assert.match(desktopContents, /Icon=vallenatrix/)
  assert.equal(iconExists, true)
})

test('installer option 2 installs 9router before Vallenatrix', () => {
  const { result, npmCalls, output, registryPatched, detailPatched, apiPatched, iconCopied } = runInstaller(true, '2\n')
  assert.equal(result.status, 0, `stdout=${result.stdout} stderr=${result.stderr} npm=${npmCalls.join('|')}`)
  assert.equal(npmCalls[0], 'i -g 9router@latest --prefer-online')
  assert.ok(npmCalls.includes('ci'))
  assert.match(output, /9router terpasang/)
  assert.equal(registryPatched, true)
  assert.equal(detailPatched, true)
  assert.equal(apiPatched, true)
  assert.equal(iconCopied, true)
})

test('installer falls back to npm install without lockfile', () => {
  const { result, npmCalls } = runInstaller(false)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(npmCalls[0], 'install')
})

test('remote bootstrap clones public source and forwards installer arguments', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'vallenatrix-bootstrap-smoke-'))
  const home = join(fixture, 'home')
  const source = join(fixture, 'downloaded')
  const template = join(fixture, 'template')
  const fakeBin = join(fixture, 'fake-bin')
  const log = join(fixture, 'git.log')
  mkdirSync(source)
  mkdirSync(template)
  mkdirSync(fakeBin)
  copyFileSync(join(repoRoot, 'install.sh'), join(source, 'install.sh'))
  copyFileSync(join(repoRoot, 'install.sh'), join(template, 'install.sh'))
  writeFileSync(join(template, 'package.json'), '{"name":"vallenatrix"}\n')
  const fakeGit = join(fakeBin, 'git')
  writeFileSync(fakeGit, '#!/bin/sh\n[ "$1" = clone ] || exit 2\nprintf "%s\\n" "$*" >> "$GIT_LOG"\nmkdir -p "$7"\ncp "$TEST_TEMPLATE/package.json" "$7/package.json"\ncp "$TEST_TEMPLATE/install.sh" "$7/install.sh"\n')
  chmodSync(fakeGit, 0o755)
  const result = spawnSync('bash', [join(source, 'install.sh'), '--help'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, GIT_LOG: log, TEST_TEMPLATE: template }
  })
  const gitCalls = existsSync(log) ? readFileSync(log, 'utf8') : ''
  rmSync(fixture, { recursive: true, force: true })
  assert.equal(result.status, 0, result.stderr)
  assert.match(gitCalls, /clone --depth 1 --branch main https:\/\/github\.com\/vallenmulia99\/vallenatrix\.git/)
  assert.match(result.stdout, /Vallenatrix Installer/)
})
