import { Router, Request, Response, NextFunction } from 'express'
import { config } from '../config'
import { requireAuth, safeEqual } from '../middleware/auth'
import { getDiscoveredWorkers, getInvalidWorkers } from '../utils/workerManager'
import { taskQueue } from '../utils/taskQueue'
import { getMcpStatus } from '../mcp/state'

const router = Router()

async function checkServices() {
  let redisReady = false
  try {
    const client = await withDeadline(taskQueue.client)
    if (client.status !== 'ready') throw new Error('Redis unavailable')
    await withDeadline(client.hget(taskQueue.toKey('meta'), 'version'))
    redisReady = true
  } catch {
    redisReady = false
  }

  let bullmqReady = false
  try {
    if (!redisReady) throw new Error('Redis unavailable')
    await withDeadline(taskQueue.getJobCounts())
    bullmqReady = true
  } catch {
    bullmqReady = false
  }

  const status = redisReady && bullmqReady ? 'ready' : 'unreachable'
  return { status, redisReady, bullmqReady }
}

async function withDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Health check timed out')), 1000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

router.get('/health', async (req: Request, res: Response, next: NextFunction) => {
  const rawAuth = req.headers['authorization'] || req.headers['x-lb-auth']
  let authKey = typeof rawAuth === 'string' ? rawAuth : undefined
  if (authKey && authKey.startsWith('Bearer ')) authKey = authKey.slice(7).trim()
  if (safeEqual(authKey, config.lbAuthKey)) return next()

  const { status } = await checkServices()
  return res.json({ status })
})

router.get('/health', requireAuth(), async (req: Request, res: Response) => {
  const { status, redisReady, bullmqReady } = await checkServices()
  res.json({
    status,
    workers: getDiscoveredWorkers(),
    invalidWorkers: getInvalidWorkers(),
    mcp: getMcpStatus(),
    services: {
      redis: redisReady ? 'ready' : 'unreachable',
      bullmq: bullmqReady ? 'ready' : 'unreachable',
    },
  })
})

export default router
