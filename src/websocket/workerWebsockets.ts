import WebSocket from 'ws'
import { getDiscoveredWorkers, updateWorkerStatus } from '../utils/workerManager'
import { log, warn } from '../utils/logger'
import { config } from '../config'

const HEARTBEAT_INTERVAL = config.wsHeartbeatInterval || 10000
const HEARTBEAT_TIMEOUT = config.wsHeartbeatTimeout || 5000

const sockets: Record<string, WebSocket> = {}
const heartbeats: Record<string, NodeJS.Timeout> = {}
const manuallyClosed = new Set<string>()

export function cleanupObsoleteWebsockets() {
  const currentUrls = new Set(getDiscoveredWorkers().map(w => w.url))
  for (const url of Object.keys(sockets)) {
    if (!currentUrls.has(url)) {
      manuallyClosed.add(url)
      sockets[url].terminate()
      delete sockets[url]
      if (heartbeats[url]) {
        clearInterval(heartbeats[url])
        delete heartbeats[url]
      }
      log('[LB]', `WebSocket cleaned up for removed worker: ${url}`)
    }
  }
}

export function connectAllWorkersWebsockets() {
  cleanupObsoleteWebsockets()
  for (const worker of getDiscoveredWorkers()) {
    if (worker.status !== 'ready' || !worker.websocketPort) continue
    const wsUrl = buildWsUrl(worker.url, worker.websocketPort)
    if (sockets[worker.url]) continue

    const ws = new WebSocket(wsUrl, config.lbAuthKey)
    sockets[worker.url] = ws

    let heartbeatTimeout: NodeJS.Timeout | null = null

    function sendPing() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('ping')
        heartbeatTimeout = setTimeout(() => {
          warn('[LB]', `No pong from ${worker.url}, closing WS and marking offline`)
          updateWorkerStatus(worker.url, 'offline')
          ws.terminate()
        }, HEARTBEAT_TIMEOUT)
      }
    }

    const interval = setInterval(sendPing, HEARTBEAT_INTERVAL)
    heartbeats[worker.url] = interval

    ws.on('open', () => {
      log('[LB]', `WebSocket connected to ${wsUrl}`)
      sendPing()
    })
    ws.on('close', () => {
      if (manuallyClosed.has(worker.url)) {
        manuallyClosed.delete(worker.url)
        return
      }
      warn('[LB]', `WebSocket closed for ${wsUrl}, will retry`)
      updateWorkerStatus(worker.url, 'offline')
      delete sockets[worker.url]
      if (heartbeats[worker.url]) clearInterval(heartbeats[worker.url])
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout)
      setTimeout(() => connectAllWorkersWebsockets(), 2000)
    })
    ws.on('error', err => warn('[LB]', `WebSocket error for ${wsUrl}:`, err.message))
    ws.on('message', msg => {
      try {
        const data = JSON.parse(msg.toString())
        const prevStatus = worker.status
        const prevSlots = JSON.stringify(worker.slots)
        updateWorkerStatus(worker.url, data.status, data.slots, data.system)
        if (worker.status !== prevStatus || JSON.stringify(worker.slots) !== prevSlots) {
          log('[LB]', `Worker ${worker.url} updated via WS: status=${data.status}, slots=${JSON.stringify(data.slots)}`)
        }
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout)
      } catch (err) {
        const error = err as Error
        warn('[LB]', `Invalid WS message from ${worker.url}:`, error.message)
      }
    })
  }
}

function buildWsUrl(httpUrl: string, wsPort: number): string {
  const url = new URL(httpUrl)
  url.protocol = url.protocol.replace('http', 'ws')
  url.port = wsPort.toString()
  return url.toString()
}
