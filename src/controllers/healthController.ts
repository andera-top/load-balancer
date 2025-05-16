import { Router, Request, Response, NextFunction } from 'express'
import { config } from '../config'
import { requireAuth } from '../middleware/auth'
import { getDiscoveredWorkers, getInvalidWorkers } from '../utils/workerManager'

const router = Router()

router.get('/health', (req: Request, res: Response, next: NextFunction) => {
  const rawAuth = req.headers['authorization'] || req.headers['x-lb-auth']
  let authKey = typeof rawAuth === 'string' ? rawAuth : undefined
  if (authKey && authKey.startsWith('Bearer ')) authKey = authKey.slice(7).trim()
  if (authKey === config.lbAuthKey) return next()
  return res.json({ status: 'ready' })
})

router.get('/health', requireAuth(), (req: Request, res: Response) => {
  res.json({
    status: 'ready',
    workers: getDiscoveredWorkers(),
    invalidWorkers: getInvalidWorkers(),
  })
})

export default router
