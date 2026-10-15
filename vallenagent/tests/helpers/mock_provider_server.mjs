import http from 'node:http'

export async function createMockProviderServer(responses) {
  const requests = []
  const waiters = []
  const queue = [...responses]
  const server = http.createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try { requests.push(JSON.parse(body)) } catch { requests.push(body) }
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (requests.length >= waiters[i].count) {
          waiters[i].resolve(requests[waiters[i].count - 1])
          waiters.splice(i, 1)
        }
      }
      const next = queue.shift() ?? { status: 500, body: { error: 'No mock response queued' } }
      if (next.hang) return
      res.writeHead(next.status ?? 200, { 'content-type': next.contentType || (next.rawBody ? 'text/event-stream' : 'application/json') })
      res.end(next.rawBody ?? JSON.stringify(next.body ?? next))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    waitForRequest: (count = 1) => requests.length >= count
      ? Promise.resolve(requests[count - 1])
      : new Promise(resolve => waiters.push({ count, resolve })),
    close: () => new Promise(resolve => server.close(resolve))
  }
}
