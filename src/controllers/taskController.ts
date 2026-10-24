import express, { Router, Request, Response } from 'express'
import { addTaskAndWait } from '../utils/taskQueue'
import { config } from '../config'
import axios from 'axios'
import { requireAuth } from '../middleware/auth'
import { error } from '../utils/logger'
import http from 'http'
import https from 'https'
import { URL } from 'url'
import { completeStreamReservation, WorkerRejectedError } from '../utils/taskProcessor'

const router = Router()

function extractBearer(header: any) {
  if (typeof header !== 'string') return ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim()
}

function validWebhookUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

router.post('/task', requireAuth(), express.json({ limit: config.requestBodyLimit }), async (req: Request, res: Response) => {
  try {
    const { group, function: fnName, contract, priority, mode, webhook, ...rest } = req.body || {}
    if (typeof group !== 'string' || !group.trim() || group !== group.trim() || typeof fnName !== 'string' || !fnName.trim() || fnName !== fnName.trim()) {
      return res.status(400).json({ error: 'Invalid group or function' })
    }
    if (!Number.isSafeInteger(contract) || contract < 1) return res.status(400).json({ error: 'Invalid contract' })
    if (priority !== undefined && (!Number.isInteger(priority) || priority < 1 || priority > 2097152))
      return res.status(400).json({ error: 'Invalid priority' })
    if (mode !== undefined && !['sync', 'stream', 'webhook'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' })
    if (rest.input !== undefined && (!rest.input || typeof rest.input !== 'object' || Array.isArray(rest.input)))
      return res.status(400).json({ error: 'Invalid input' })
    const payload = { group, function: fnName, contract, mode, webhook, ...rest }
    const wrAuth = extractBearer(req.headers['x-wr-auth'])
    if (!wrAuth) {
      return res.status(400).json({ error: 'Missing x-wr-auth header (worker AUTH_KEY) in request' })
    }
    if (mode === 'webhook') {
      if (
        !webhook ||
        typeof webhook !== 'object' ||
        !validWebhookUrl(webhook.url) ||
        (webhook.headers !== undefined &&
          (!webhook.headers ||
            typeof webhook.headers !== 'object' ||
            Array.isArray(webhook.headers) ||
            Object.values(webhook.headers).some(value => typeof value !== 'string')))
      ) {
        return res.status(400).json({ error: 'Missing or invalid webhook.url for mode webhook' })
      }
      addTaskAndWait(payload, { priority, timeout: config.taskTimeout, authorization: wrAuth }).catch(err => {
        error('[LB]', 'Failed to enqueue task in webhook mode:', err)
      })
      return res.json({ success: true, message: 'Task accepted, result will be sent to webhook' })
    }
    if (mode === 'stream') {
      let releaseReservation = () => {}
      try {
        const result = await addTaskAndWait(payload, { priority, timeout: config.taskTimeout, authorization: wrAuth })
        const { workerUrl, reservationId } = result as { workerUrl: string; reservationId: string }
        let released = false
        const release = () => {
          if (released) return
          released = true
          completeStreamReservation(reservationId)
        }
        releaseReservation = release
        if (res.destroyed) {
          release()
          return
        }
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
          res.status(proxyRes.statusCode || 502)
          res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/octet-stream')
          // Stop compression from buffering the stream until it ends.
          res.setHeader('Cache-Control', 'no-transform')
          proxyRes.pipe(res)
          proxyRes.once('end', release)
          const abortStream = () => {
            release()
            if (!res.destroyed) res.destroy()
          }
          proxyRes.once('error', abortStream)
          proxyRes.once('aborted', abortStream)
        })

        res.once('close', () => {
          release()
          if (!proxyReq.destroyed) proxyReq.destroy()
        })

        proxyReq.on('error', () => {
          release()
          if (!res.headersSent) res.status(502)
          res.end('Stream failed')
        })
        proxyReq.setTimeout(config.taskTimeout, () => proxyReq.destroy(new Error('Stream timed out')))

        proxyReq.write(JSON.stringify(payload))
        proxyReq.end()
      } catch (err: any) {
        // Setup can fail after the reservation was transferred: free the Worker slot.
        releaseReservation()
        res.status(503).json({ error: 'No available worker for this group/contract/function' })
      }
      return
    }
    const result = await addTaskAndWait(payload, { priority, timeout: config.taskTimeout, authorization: wrAuth })
    res.json(result)
  } catch (err: any) {
    if (err instanceof WorkerRejectedError) return res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: 'Task failed or timed out' })
  }
})

export default router
