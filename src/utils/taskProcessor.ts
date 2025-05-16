import { Worker } from 'bullmq'
import { getPendingTaskResolver, clearPendingTask, authKeyMap } from './taskQueue'
import { selectBestWorker, reserveSlot, releaseSlot, getDiscoveredWorkers } from './workerManager'
import axios from 'axios'
import { config } from '../config'
import { log } from './logger'

function computeTotalSlots() {
  return getDiscoveredWorkers().reduce((sum, w) => sum + (w.slots?.limit || 0), 0)
}

let worker: Worker | undefined = undefined
let currentConcurrency = 0

export function startTaskWorker() {
  currentConcurrency = computeTotalSlots() || 1
  worker = new Worker(
    'tasks',
    async job => {
      const payload = job.data
      const resolver = getPendingTaskResolver(payload._taskId)
      if (!resolver) return
      let selectedWorker = null
      try {
        selectedWorker = selectBestWorker({ group: payload.group, contract: payload.contract, function: payload.function })
        if (!selectedWorker || !reserveSlot(selectedWorker.url)) {
          throw new Error('No available worker slot for this group/contract/function')
        }
        const url = selectedWorker.url.endsWith('/') ? selectedWorker.url + 'task' : selectedWorker.url + '/task'
        const headers: Record<string, string> = {
          authorization: authKeyMap.get(payload._taskId) || '',
          'x-lb-auth': config.lbAuthKey,
          'content-type': 'application/json',
        }
        try {
          if (payload.mode === 'stream') {
            resolver.resolve({ workerUrl: selectedWorker.url })
            authKeyMap.delete(payload._taskId)
          } else {
            const response = await axios.post(url, payload, { headers, timeout: 60000 })
            resolver.resolve(response.data)
            authKeyMap.delete(payload._taskId)
          }
        } catch (err: any) {
          throw err
        }
      } catch (err: any) {
        throw err
      } finally {
        if (selectedWorker) releaseSlot(selectedWorker.url)
        clearPendingTask(payload._taskId)
      }
    },
    {
      connection: {
        host: config.bullmq.redisHost,
        port: config.bullmq.redisPort,
      },
      concurrency: currentConcurrency,
    }
  )
}

export function updateWorkerConcurrency() {
  if (!worker) return
  const newConcurrency = computeTotalSlots() || 1
  if (currentConcurrency !== newConcurrency) {
    log('[LB]', `BullMQ concurrency updated: ${currentConcurrency} -> ${newConcurrency}`)
    worker.concurrency = newConcurrency
    currentConcurrency = newConcurrency
  }
}
