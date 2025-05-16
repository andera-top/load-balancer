import { Queue, Job } from 'bullmq'
import { config } from '../config'
import { v4 as uuidv4 } from 'uuid'
import { ExpressAdapter } from '@bull-board/express'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'

const taskQueue = new Queue('tasks', {
  connection: {
    host: config.bullmq.redisHost,
    port: config.bullmq.redisPort,
  },
})

const pendingTasks: Record<string, { resolve: (result: any) => void; reject: (err: any) => void }> = {}
const authKeyMap = new Map<string, string>()

export async function addTaskAndWait(payload: any, opts: { priority?: number; timeout?: number; authorization?: string } = {}) {
  const taskId = uuidv4()
  const timeoutMs = opts.timeout || 60000
  if (opts.authorization) {
    authKeyMap.set(taskId, opts.authorization)
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearPendingTask(taskId)
      reject(new Error('Task timed out'))
    }, timeoutMs)
    pendingTasks[taskId] = {
      resolve: result => {
        clearTimeout(timer)
        clearPendingTask(taskId)
        resolve(result)
      },
      reject: err => {
        clearTimeout(timer)
        clearPendingTask(taskId)
        reject(err)
      },
    }
    taskQueue
      .add(
        'task',
        { ...payload, _taskId: taskId },
        {
          priority: opts.priority,
          attempts: config.taskAttempts,
          removeOnComplete: { age: 86400 },
          removeOnFail: { age: 86400 },
        }
      )
      .catch(reject)
  })
}

export function getPendingTaskResolver(taskId: string) {
  return pendingTasks[taskId]
}

export function clearPendingTask(taskId: string) {
  delete pendingTasks[taskId]
}

export { taskQueue, serverAdapter, authKeyMap }

const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath('/bull')

createBullBoard({
  queues: [new BullMQAdapter(taskQueue)],
  serverAdapter,
})
