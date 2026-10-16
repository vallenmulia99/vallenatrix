import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requiresApproval, requiresDangerousApproval, approvalMode } from '../dist/approval.js'

test('approval: dangerous mode gates destructive shell, allows project commands', () => {
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'git status' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'ls -la src' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'ls -la; node -v; python3 -V; npm -v' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'pwd && git status --short' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'which chromium chromium-browser google-chrome firefox xvfb-run 2>/dev/null; echo "---"; npm -v' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: `cd vallen-anime-space-rpg && for f in $(find src tests server.mjs -name '*.js' -o -name '*.mjs'); do node --check "$f" || echo "SYNTAX FAIL $f"; done; echo "--- syntax ok ---"; npm test` } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'cd /home/vallenganteng/Dokumen/gametest/vallen-anime-space-rpg && npm test 2>&1 | tail -30 && git log --oneline -5 2>/dev/null | head' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'cd /home/vallenganteng/project && npm test 2>&1 | tail -30 && rm -rf /tmp/x' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'ls -la; rm -rf /tmp/x' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'git commit -m "x"' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'rm -rf /tmp/x' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'cd /tmp && rm -rf x' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'curl -X POST https://x -d @file' } }, 'dangerous'), true)
})

test('approval: reads allowed, writes into sensitive paths gated', () => {
  assert.equal(requiresApproval({ name: 'read_file', args: { path: '~/.ssh/id_rsa' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'write_file', args: { path: '~/.ssh/config' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'write_file', args: { path: '/etc/hosts' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'write_file', args: { path: 'src/index.ts' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'read_file', args: { path: 'src/index.ts' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'search_files', args: { path: '.' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'patch', args: { path: '~/.vallenatrix/config.json' } }, 'dangerous'), true)
})

test('approval: code execution and skill mutations always gated in dangerous mode', () => {
  assert.equal(requiresApproval({ name: 'execute_code', args: { code: 'print(1)' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'browser_exec', args: { code: 'x' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'skill_manage', args: { action: 'patch', name: 'x' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'skill_manage', args: { action: 'view', name: 'x' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'skill_view', args: { name: 'x' } }, 'dangerous'), false)
})

test('approval: mode off bypasses every tool; safe mode and all mode keep their gates', () => {
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'rm -rf /' } }, 'off'), false)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'cd /tmp && node vallen-diag6.mjs' } }, 'off'), false)
  assert.equal(requiresApproval({ name: 'execute_code', args: { code: 'print(1)' } }, 'off'), false)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'cd /tmp && node vallen-diag6.mjs' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'execute_code', args: { code: 'print(1)' } }, 'dangerous'), true)
  assert.equal(requiresApproval({ name: 'read_file', args: { path: 'src/a.ts' } }, 'all'), true)
})

test('approval: mode resolves from env override then config', () => {
  delete process.env.VALLENATRIX_APPROVAL
  assert.equal(approvalMode(), 'dangerous')
  assert.equal(approvalMode('off'), 'off')
  assert.equal(approvalMode('all'), 'all')
  assert.equal(approvalMode('bogus'), 'dangerous')
  process.env.VALLENATRIX_APPROVAL = 'off'
  try {
    assert.equal(approvalMode('all'), 'off')
  } finally {
    delete process.env.VALLENATRIX_APPROVAL
  }
  assert.equal(approvalMode('all'), 'all')
})

test('approval: strictest helper still gates every risky class', () => {
  assert.equal(requiresDangerousApproval({ name: 'terminal', args: { command: 'git push --force origin main' } }, ), true)
  assert.equal(requiresDangerousApproval({ name: 'terminal', args: { command: 'pwd' } }), false)
})
