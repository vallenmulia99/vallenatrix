import { restartTelegramGateway, startTelegramGateway, stopTelegramGateway, telegramStatus } from './manager'

const [action = 'status'] = process.argv.slice(2)
if (action === 'start') console.log(startTelegramGateway().message)
else if (action === 'stop') console.log(stopTelegramGateway().message)
else if (action === 'restart') {
  void restartTelegramGateway().then(result => console.log(result.message)).catch(error => {
    console.error(error instanceof Error ? error.message : 'Gateway restart failed.')
    process.exitCode = 1
  })
} else if (action === 'status') {
  const status = telegramStatus()
  console.log(JSON.stringify(status, null, 2))
} else {
  console.error('Usage: node dist/gateway/cli.js start|stop|restart|status')
  process.exitCode = 2
}
