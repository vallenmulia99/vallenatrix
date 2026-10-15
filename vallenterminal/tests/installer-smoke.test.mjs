import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function runInstaller(withLockfile) {
  const fixture = mkdtempSync(join(tmpdir(), 'vallenatrix-installer-smoke-'))
  const home = join(fixture, 'home')
  const project = join(fixture, 'project')
  const fakeBin = join(fixture, 'fake-bin')
  mkdirSync(join(project, 'bin'), { recursive: true })
  mkdirSync(join(project, 'vallenterminal', 'assets'), { recursive: true })
  mkdirSync(fakeBin)
  copyFileSync(join(repoRoot, 'install.sh'), join(project, 'install.sh'))
  writeFileSync(join(project, 'package.json'), '{"name":"vallenatrix"}\n')
  copyFileSync(join(repoRoot, 'vallenterminal', 'assets', 'vallenatrix.png'), join(project, 'vallenterminal', 'assets', 'vallenatrix.png'))
  writeFileSync(join(project, 'bin', 'vallenatrix'), '#!/bin/sh\nexit 0\n')
  if (withLockfile) writeFileSync(join(project, 'package-lock.json'), '{}\n')
  writeFileSync(join(fakeBin, 'node'), '#!/bin/sh\n[ "$1" = "-v" ] && printf "v20.0.0\\n"\n')
  writeFileSync(join(fakeBin, 'npm'), '#!/bin/sh\n[ "$1" = "-v" ] && { printf "10.0.0\\n"; exit 0; }\nprintf "%s\\n" "$*" >> "$NPM_LOG"\n')
  chmodSync(join(fakeBin, 'node'), 0o755)
  chmodSync(join(fakeBin, 'npm'), 0o755)
  const log = join(fixture, 'npm.log')
  const result = spawnSync('bash', [join(project, 'install.sh')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, NPM_LOG: log }
  })
  const npmCalls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
  const link = join(home, '.local', 'bin', 'vallenatrix')
  const output = result.stdout + result.stderr
  const linkTarget = existsSync(link) ? readlinkSync(link) : null
  const desktop = join(home, '.local', 'share', 'applications', 'vallenatrix.desktop')
  const icon = join(home, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps', 'vallenatrix.png')
  const desktopContents = existsSync(desktop) ? readFileSync(desktop, 'utf8') : ''
  const iconExists = existsSync(icon)
  rmSync(fixture, { recursive: true, force: true })
  return { result, npmCalls, output, linkTarget, expectedTarget: join(project, 'bin', 'vallenatrix'), desktopContents, iconExists }
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
