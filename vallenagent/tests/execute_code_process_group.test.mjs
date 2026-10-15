import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { registry } from '../dist/tools.js'

test('execute_code abort kills child processes in its process group', async t => {
  const home = mkdtempSync(join(tmpdir(), 'execute-group-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  new AIAgent({ isSubagent: true })
  const pidFile = join(home, 'child.pid')
  const controller = new AbortController()
  const code = `import subprocess,time\np=subprocess.Popen(['python3','-c','import time; time.sleep(12)'])\nopen(${JSON.stringify(pidFile)},'w').write(str(p.pid))\ntime.sleep(12)`
  const resultPromise = registry.execute('execute_code', { code, timeout_s: 20 }, { workingDir: home }, undefined, controller.signal)
  let childPid
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !existsSync(pidFile)) await new Promise(resolve => setTimeout(resolve, 25))
  assert.ok(existsSync(pidFile), 'child process did not start')
  childPid = Number(readFileSync(pidFile, 'utf8'))
  try {
    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 200))
    const procStat = `/proc/${childPid}/stat`
    const running = existsSync(procStat) && readFileSync(procStat, 'utf8').split(' ')[2] !== 'Z'
    assert.equal(running, false, `child process ${childPid} survived abort`)
  } finally {
    try { process.kill(childPid, 'SIGKILL') } catch {}
    await resultPromise
  }
})

test('execute_code timeout kills child processes too', async t => {
  const home = mkdtempSync(join(tmpdir(), 'execute-timeout-group-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  new AIAgent({ isSubagent: true })
  const pidFile = join(home, 'child.pid')
  const code = `import subprocess,time; p=subprocess.Popen(['python3','-c','import time; time.sleep(20)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); open(${JSON.stringify(pidFile)},'w').write(str(p.pid)); time.sleep(20)`
  const result = JSON.parse(await registry.execute('execute_code', { code, timeout_s: 1 }, { workingDir: home }))
  const childPid = Number(readFileSync(pidFile, 'utf8'))
  try {
    assert.equal(result.timed_out, true)
    const procStat = `/proc/${childPid}/stat`
    const running = existsSync(procStat) && readFileSync(procStat, 'utf8').split(' ')[2] !== 'Z'
    assert.equal(running, false, `child process ${childPid} survived timeout`)
  } finally {
    try { process.kill(childPid, 'SIGKILL') } catch {}
  }
})
