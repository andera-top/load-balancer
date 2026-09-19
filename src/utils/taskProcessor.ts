import { Worker, DelayedError } from 'bullmq'
import { getPendingTaskResolver, authKeyMap } from './taskQueue'
import { selectBestWorker, reserveSlot, releaseSlot, getDiscoveredWorkers, hasMatchingWorker } from './workerManager'
import axios from 'axios'
import { config } from '../config'
import { log } from './logger'

function computeTotalSlots() {
  return getDiscoveredWorkers().reduce((sum, w) => sum + (w.slots?.limit || 0), 0)
}

let worker: Worker | undefined = undefined
let currentConcurrency = 0
const streamCompletions = new Map<string, () => void>()

export function completeStreamReservation(taskId: string) {
  const complete = streamCompletions.get(taskId)
  if (!complete) return
  streamCompletions.delete(taskId)
  complete()
}

export function startTaskWorker() {
  currentConcurrency = computeTotalSlots() || 1
  worker = new Worker(
    'tasks',
    async (job, token) => {
      const payload = job.data
      const resolver = getPendingTaskResolver(payload._taskId)
      if (!resolver) {
        // Pending promises and credentials intentionally stay in process memory.
        // A different LB instance (or a restarted one) cannot safely resume this job.
        throw new Error('Task context is no longer available')
      }
      let selectedWorker = null
      let reserved = false
      try {
        const selection = { group: payload.group, contract: payload.contract, function: payload.function, mode: payload.mode }
        selectedWorker = selectBestWorker(selection)
        reserved = !!selectedWorker && reserveSlot(selectedWorker.url)
        if (!reserved && hasMatchingWorker(selection)) {
          // Saturation is not an execution failure: wait without consuming retries.
          await job.moveToDelayed(Date.now() + 100, token)
          throw new DelayedError()
        }
        if (!selectedWorker || !reserved) {
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
            const streamFinished = new Promise<void>(resolve => streamCompletions.set(payload._taskId, resolve))
            const transferred = resolver.resolve({ workerUrl: selectedWorker.url, reservationId: payload._taskId })
            authKeyMap.delete(payload._taskId)
            if (!transferred) {
              completeStreamReservation(payload._taskId)
              return
            }
            // Keep the BullMQ concurrency and local Worker slot until the proxy
            // response ends, errors, times out, or its client disconnects.
            await streamFinished
          } else {
            const response = await axios.post(url, payload, { headers, timeout: config.taskTimeout, maxRedirects: 0 })
            resolver.resolve(response.data)
            authKeyMap.delete(payload._taskId)
          }
        } catch (err: any) {
          throw err
        }
      } catch (err: any) {
        if (err instanceof DelayedError) throw err
        // Keep the resolver for retries and settle it on the last failure.
        // Never retain Axios request configuration (including auth headers) in Redis.
        if (job.attemptsMade + 1 >= (job.opts.attempts || 1)) {
          resolver.reject(new Error('Worker task failed or no matching slot is available'))
        }
        throw new Error('Worker task failed or no matching slot is available')
      } finally {
        if (reserved && selectedWorker) releaseSlot(selectedWorker.url)
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
  worker.on('error', () => log('[LB]', 'Task processor connection error'))
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
