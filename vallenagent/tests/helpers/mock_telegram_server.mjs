import { createServer } from 'node:http'

export async function createMockTelegramServer() {
  const updates = []
  const calls = []
  let waiter
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    const path = new URL(request.url, 'http://localhost').pathname
    const method = path.split('/').at(-1)
    const payload = body ? JSON.parse(body) : {}
    calls.push({ method, payload })
    const json = value => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, result: value }))
    }
    if (method === 'getMe') return json({ id: 999, username: 'mock_vallen_bot' })
    if (method === 'deleteWebhook') return json(true)
    if (method === 'sendMessage') return json({ message_id: calls.length })
    if (method === 'sendChatAction' || method === 'answerCallbackQuery') return json(true)
    if (method === 'getUpdates') {
      const ready = () => updates.filter(update => update.update_id >= Number(payload.offset || 0))
      if (ready().length) return json(ready())
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 300)
        waiter = () => { clearTimeout(timeout); resolve() }
      })
      return json(ready())
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: false, description: 'unknown mock method' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    apiRoot: `http://127.0.0.1:${server.address().port}`,
    calls,
    push(update) { updates.push(update); waiter?.(); waiter = undefined },
    close: () => new Promise(resolve => server.close(resolve))
  }
}
