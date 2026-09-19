import { Router, Request, Response } from 'express'
import { getDiscoveredWorkers } from '../utils/workerManager'
import axios from 'axios'
import { config } from '../config'
import { getMcpStatus } from '../mcp/state'

const router = Router()

router.get('/api/mcp', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const status = getMcpStatus()
  res.json({
    enabled: status.enabled,
    endpoint: status.endpoint,
    transport: status.transport,
    toolCount: status.tools.length,
    tools: status.tools.map((tool: any) => ({ title: tool.title || tool.function, available: tool.available })),
  })
})

router.get('/api/workers', (req: Request, res: Response) => {
  res.json(getDiscoveredWorkers())
})

router.get('/api/workers/:encodedUrl/logs', async (req: Request, res: Response) => {
  let url: string
  try {
    url = Buffer.from(req.params.encodedUrl, 'base64url').toString('utf-8')
  } catch (e) {
    return res.status(400).json({ error: 'Invalid worker URL encoding' })
  }
  const worker = getDiscoveredWorkers().find(candidate => candidate.url === url)
  if (!worker) return res.status(404).json({ error: 'Worker not found' })
  try {
    const resp = await axios.get(url.endsWith('/') ? url + 'logs' : url + '/logs', {
      headers: { 'x-lb-auth': config.lbAuthKey },
      timeout: config.workerDiscoveryTimeout,
      maxRedirects: 0,
    })
    res.json(resp.data)
  } catch (err) {
    const error = err as any
    if (error && error.response) {
      res.status(502).json({ error: 'Worker unreachable', status: error.response.status })
    } else {
      res.status(502).json({ error: 'Worker unreachable' })
    }
  }
})

export default router
