import { Router, Request, Response } from 'express'
import { getDiscoveredWorkers } from '../utils/workerManager'
import axios from 'axios'
import { config } from '../config'

const router = Router()

router.get('/api/workers', (req: Request, res: Response) => {
  res.json(getDiscoveredWorkers())
})

router.get('/api/workers/:encodedUrl/health', async (req: Request, res: Response) => {
  const url = decodeURIComponent(req.params.encodedUrl)
  try {
    const resp = await axios.get(url.endsWith('/') ? url + 'health' : url + '/health', {
      headers: { 'x-lb-auth': config.lbAuthKey },
    })
    res.json(resp.data)
  } catch (err) {
    res.status(500).json({ error: 'Worker unreachable' })
  }
})

router.get('/api/workers/:encodedUrl/logs', async (req: Request, res: Response) => {
  const url = decodeURIComponent(req.params.encodedUrl)
  try {
    const resp = await axios.get(url.endsWith('/') ? url + 'logs' : url + '/logs', {
      headers: { 'x-lb-auth': config.lbAuthKey },
    })
    res.json(resp.data)
  } catch (err) {
    res.status(500).json({ error: 'Worker unreachable' })
  }
})

export default router
