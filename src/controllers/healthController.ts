import { Router, Request, Response, NextFunction } from 'express'
import { config } from '../config'
import { requireAuth } from '../middleware/auth'
import { getDiscoveredWorkers, getInvalidWorkers } from '../utils/workerManager'
import { taskQueue } from '../utils/taskQueue'

const router = Router()

async function checkServices() {
  let redisReady = false
  try {
    const client = await taskQueue.client
    await client.set('healthcheck:test', '1', 'EX', 5)
    redisReady = true
  } catch {
    redisReady = false
  }

  let bullmqReady = false
  try {
    await taskQueue.getJobCounts()
    bullmqReady = true
  } catch {
    bullmqReady = false
  }

  const status = redisReady && bullmqReady ? 'ready' : 'unreachable'
  return { status, redisReady, bullmqReady }
}

router.get('/health', async (req: Request, res: Response, next: NextFunction) => {
  const rawAuth = req.headers['authorization'] || req.headers['x-lb-auth']
  let authKey = typeof rawAuth === 'string' ? rawAuth : undefined
  if (authKey && authKey.startsWith('Bearer ')) authKey = authKey.slice(7).trim()
  if (authKey === config.lbAuthKey) return next()

  const { status } = await checkServices()
  return res.json({ status })
})

router.get('/health', requireAuth(), async (req: Request, res: Response) => {
  const { status, redisReady, bullmqReady } = await checkServices()
  res.json({
    status,
    workers: getDiscoveredWorkers(),
    invalidWorkers: getInvalidWorkers(),
    services: {
      redis: redisReady ? 'ready' : 'unreachable',
      bullmq: bullmqReady ? 'ready' : 'unreachable',
    },
  })
})

export default router
