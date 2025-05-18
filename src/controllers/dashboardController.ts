import { Router, Request, Response } from 'express'
import { getDiscoveredWorkers } from '../utils/workerManager'
import axios from 'axios'
import { config } from '../config'

const router = Router()

router.get('/api/workers', (req: Request, res: Response) => {
  res.json(getDiscoveredWorkers())
})

router.get('/api/workers/:encodedUrl/logs', async (req: Request, res: Response) => {
  let url: string;
  try {
    url = Buffer.from(req.params.encodedUrl, 'base64').toString('utf-8');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid worker URL encoding' });
  }
  try {
    const resp = await axios.get(url.endsWith('/') ? url + 'logs' : url + '/logs', {
      headers: { 'x-lb-auth': config.lbAuthKey },
    })
    res.json(resp.data)
  } catch (err) {
    const error = err as any;
    if (error && error.response) {
      res.status(500).json({ error: 'Worker unreachable', details: error.response.data, status: error.response.status })
    } else {
      res.status(500).json({ error: 'Worker unreachable', details: error && error.message })
    }
  }
})

export default router
