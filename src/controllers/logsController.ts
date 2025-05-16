import { Router, Request, Response } from 'express'
import { getLogs } from '../utils/logger'
import { requireAuth } from '../middleware/auth'

const router = Router()

router.get('/logs', requireAuth(), (req: Request, res: Response) => {
  const logs = getLogs()
  res.json({ logs })
})

export default router
