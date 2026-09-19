import express from 'express'
import compression from 'compression'
import { config } from './config'
import { log } from './utils/logger'
import healthController from './controllers/healthController'
import taskController from './controllers/taskController'
import logsController from './controllers/logsController'
import dashboardController from './controllers/dashboardController'
import { defaultController } from './controllers/defaultController'
import { discoverWorkers } from './utils/workerManager'
import { connectAllWorkersWebsockets } from './websocket/workerWebsockets'
import './utils/taskProcessor'
import { serverAdapter as bullBoardAdapter } from './utils/taskQueue'
import path from 'path'
import chokidar from 'chokidar'
import { startTaskWorker } from './utils/taskProcessor'
import { getDiscoveredWorkers } from './utils/workerManager'
import { addTaskAndWait } from './utils/taskQueue'
import { createBalancerMcp } from './mcp/runtime'
import { setMcpStatus } from './mcp/state'
import { WORKERS_PATH } from './config/workers'

const app = express()

app.use(compression())
const mcp = createBalancerMcp({
  root: path.resolve(__dirname, '..'),
  workers: getDiscoveredWorkers,
  dispatch: (payload, opts) => addTaskAndWait(payload, { ...opts, timeout: config.taskTimeout }),
  report: message => log('[MCP]', message),
})
setMcpStatus(mcp.status)
app.use('/mcp', mcp.router)

if (config.dashboardEnabled) {
  app.use('/dashboard', express.static(path.join(__dirname, '../dashboard/dist')))
  app.use('/dashboard', dashboardController)
}

app.use('/assets', express.static(path.join(__dirname, '../assets')))

function mountControllers(app: express.Application) {
  app.use(defaultController)
  app.use(healthController)
  app.use(taskController)
  app.use(logsController)
}

mountControllers(app)

if (config.bullBoardEnabled) {
  app.use('/bull', bullBoardAdapter.getRouter())
}

app.listen(config.port, () => {
  log('[LB]', `Load Balancer ready on port ${config.port}`)
  startTaskWorker()
  const refresh = async () => {
    try {
      await discoverWorkers()
      connectAllWorkersWebsockets()
    } catch {
      log('[LB]', 'Worker discovery failed; will retry')
    }
  }
  void refresh()
  setInterval(() => {
    void refresh()
  }, config.workerDiscoveryInterval)

  chokidar
    .watch(WORKERS_PATH, { ignoreInitial: true, atomic: true })
    .on('all', async event => {
      if (!['add', 'change', 'unlink'].includes(event)) return
      log('[LB]', 'workers.json changed, hot reloading workers...')
      await refresh()
    })
    .on('error', () => log('[LB]', 'Unable to watch workers.json'))
})

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  log('[LB]', 'Unhandled request error')
  if (res.headersSent) {
    return next(err)
  }
  const status = err?.type === 'entity.too.large' ? 413 : err instanceof SyntaxError && 'body' in err ? 400 : 500
  res.status(status).json({ error: status < 500 ? 'Invalid request' : 'Internal server error' })
})
