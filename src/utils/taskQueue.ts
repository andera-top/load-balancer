import { Queue, Job } from 'bullmq'
import { config } from '../config'
import { v4 as uuidv4 } from 'uuid'
import { ExpressAdapter } from '@bull-board/express'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { error } from './logger'

const taskQueue = new Queue('tasks', {
  connection: {
    host: config.bullmq.redisHost,
    port: config.bullmq.redisPort,
  },
})
taskQueue.on('error', () => error('[LB]', 'Queue connection error'))

const pendingTasks: Record<string, { resolve: (result: any) => boolean; reject: (err: any) => boolean }> = {}
const authKeyMap = new Map<string, string>()
// Webhook headers often carry the receiver's credentials: keep them out of Redis and Bull Board.
const webhookHeadersMap = new Map<string, Record<string, string>>()

export async function addTaskAndWait(payload: any, opts: { priority?: number; timeout?: number; authorization?: string; attempts?: number } = {}) {
  const taskId = uuidv4()
  const timeoutMs = opts.timeout || 60000
  if (opts.authorization) {
    authKeyMap.set(taskId, opts.authorization)
  }
  if (payload.webhook?.headers) {
    webhookHeadersMap.set(taskId, payload.webhook.headers)
    payload = { ...payload, webhook: { ...payload.webhook, headers: undefined } }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearPendingTask(taskId)
      reject(new Error('Task timed out'))
    }, timeoutMs)
    pendingTasks[taskId] = {
      resolve: result => {
        if (!pendingTasks[taskId]) return false
        clearTimeout(timer)
        clearPendingTask(taskId)
        resolve(result)
        return true
      },
      reject: err => {
        if (!pendingTasks[taskId]) return false
        clearTimeout(timer)
        clearPendingTask(taskId)
        reject(err)
        return true
      },
    }
    taskQueue
      .add(
        'task',
        { ...payload, _taskId: taskId },
        {
          priority: opts.priority,
          attempts: opts.attempts ?? config.taskAttempts,
          removeOnComplete: { age: 86400 },
          removeOnFail: { age: 86400 },
        }
      )
      .catch(err => pendingTasks[taskId]?.reject(err))
  })
}

export function getPendingTaskResolver(taskId: string) {
  return pendingTasks[taskId]
}

export function clearPendingTask(taskId: string) {
  delete pendingTasks[taskId]
  authKeyMap.delete(taskId)
  webhookHeadersMap.delete(taskId)
}

export { taskQueue, serverAdapter, authKeyMap, webhookHeadersMap }

const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath('/bull')

createBullBoard({
  queues: [new BullMQAdapter(taskQueue)],
  serverAdapter,
})
