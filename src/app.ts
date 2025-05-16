import express from 'express'
import compression from 'compression'
import { config } from './config'
import { Queue } from 'bullmq'
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

const app = express()

app.use(compression())
app.use(express.json())

if (config.dashboardEnabled) {
  app.use('/dashboard', express.static(path.join(__dirname, '../dashboard/dist')))
  app.use('/dashboard', dashboardController)
}

app.use('/assets', express.static(path.join(__dirname, '../assets')))

export const taskQueue = new Queue('tasks', {
  connection: {
    host: config.bullmq.redisHost,
    port: config.bullmq.redisPort,
  },
})

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
  discoverWorkers().then(() => {
    log('[LB]', 'Initial worker discovery complete')
    startTaskWorker()
    connectAllWorkersWebsockets()
  })
  setInterval(async () => {
    await discoverWorkers()
    connectAllWorkersWebsockets()
  }, config.workerDiscoveryInterval)

  const workersPath = path.resolve(__dirname, '../../workers.json')
  chokidar.watch(workersPath).on('change', async () => {
    log('[LB]', 'workers.json changed, hot reloading workers...')
    await discoverWorkers()
    connectAllWorkersWebsockets()
  })
})

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  log('[LB]', 'Unhandled error (détail):', typeof err, err, JSON.stringify(err), err && err.stack)
  if (res.headersSent) {
    return next(err)
  }
  res.status(500).json({ error: 'Internal server error' })
})
