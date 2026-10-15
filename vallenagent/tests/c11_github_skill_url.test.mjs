import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchGitHubSkill } from '../dist/skills_hub_search.js'

test('fetchGitHubSkill rejects shell-injection URLs before running git', async () => {
  await assert.rejects(fetchGitHubSkill('https://github.com/owner";touch /tmp/vallenatrix-pwn;"/repo'), /Invalid GitHub skill URL/)
  await assert.rejects(fetchGitHubSkill('https://attacker.example/owner/repo'), /Invalid GitHub skill URL/)
})