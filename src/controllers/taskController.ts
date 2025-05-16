import { Router, Request, Response } from 'express'
import { addTaskAndWait } from '../utils/taskQueue'
import { config } from '../config'
import axios from 'axios'
import { requireAuth } from '../middleware/auth'
import { error } from '../utils/logger'
import http from 'http'
import https from 'https'
import { URL } from 'url'

const router = Router()

function extractBearer(header: any) {
  if (typeof header !== 'string') return ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim()
}

router.post('/task', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const { group, function: fnName, contract, priority, mode, webhook, ...rest } = req.body
    if (!group || !fnName || !contract) {
      return res.status(400).json({ error: 'Missing group, function, or contract' })
    }
    const payload = { group, function: fnName, contract, mode, webhook, ...rest }
    const wrAuth = extractBearer(req.headers['x-wr-auth'])
    if (!wrAuth) {
      return res.status(400).json({ error: 'Missing x-wr-auth header (worker AUTH_KEY) in request' })
    }
    if (mode === 'webhook') {
      if (!webhook || typeof webhook !== 'object' || typeof webhook.url !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid webhook.url for mode webhook' })
      }
      addTaskAndWait(payload, { priority, timeout: config.taskTimeout, authorization: wrAuth }).catch(err => {
        error('[LB]', 'Failed to enqueue task in webhook mode:', err)
      })
      return res.json({ success: true, message: 'Task accepted, result will be sent to webhook' })
    }
    if (mode === 'stream') {
      try {
        const result = await addTaskAndWait(payload, { priority, timeout: config.taskTimeout, authorization: wrAuth })
        const { workerUrl } = result as { workerUrl: string }
        const urlObj = new URL(workerUrl.endsWith('/') ? workerUrl + 'task' : workerUrl + '/task')
        const isHttps = urlObj.protocol === 'https:'
        const client = isHttps ? https : http

        const reqOptions = {
          method: 'POST',
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname,
          headers: {
            authorization: wrAuth || '',
            'x-lb-auth': config.lbAuthKey,
            'content-type': 'application/json',
          },
        }

        const proxyReq = client.request(reqOptions, proxyRes => {
          res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/octet-stream')
          proxyRes.pipe(res)
        })

        proxyReq.on('error', err => {
          res.status(500).end('Stream error: ' + err.message)
        })

        proxyReq.write(JSON.stringify(payload))
        proxyReq.end()
      } catch (err: any) {
        res.status(503).json({ error: err.message || 'No available worker for this group/contract/function' })
      }
      return
    }
    const result = await addTaskAndWait(payload, { priority, timeout: config.taskTimeout, authorization: wrAuth })
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Task failed or timed out' })
  }
})

export default router
