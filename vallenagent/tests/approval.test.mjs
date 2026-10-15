import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requiresApproval, requiresDangerousApproval, approvalMode } from '../dist/approval.js'

test('approval: dangerous mode gates destructive shell, allows project commands', () => {
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'git status' } }, 'dangerous'), false)
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'ls -la src' } }, 'dangerous'), false)
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

test('approval: mode off bypasses, mode all gates everything', () => {
  assert.equal(requiresApproval({ name: 'terminal', args: { command: 'rm -rf /' } }, 'off'), false)
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
