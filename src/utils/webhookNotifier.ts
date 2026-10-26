import axios from 'axios'
import { warn } from './logger'
import { WorkerRejectedError } from './taskProcessor'
import { TaskTimeoutError } from './taskQueue'

// Same delivery policy as the Worker's default webhook settings.
const TIMEOUT = 5000
const MAX_RETRIES = 3
const RETRY_DELAY = 1000

export function webhookFailure(err: unknown): { error: string; code: string } {
  if (err instanceof WorkerRejectedError) return { error: err.message, code: err.code || 'WORKER_REJECTED' }
  if (err instanceof TaskTimeoutError) return { error: 'Task timed out', code: 'TASK_TIMEOUT' }
  return { error: 'Task failed', code: 'TASK_FAILED' }
}

/** Tells a webhook receiver that its task produced no result. Results themselves are posted by the Worker. */
export async function notifyWebhookFailure(url: string, headers: Record<string, string> | undefined, failure: { error: string; code: string }) {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      await axios.post(
        url,
        { success: false, ...failure },
        {
          timeout: TIMEOUT,
          maxRedirects: 0,
          // The response body is unused: never decompress data chosen by the destination.
          decompress: false,
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Andera', ...headers, 'X-Andera-Status': 'failed' },
        }
      )
      return
    } catch {
      if (attempt > MAX_RETRIES) {
        warn('[LB]', 'Failed to notify the webhook of a task failure')
        return
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))
    }
  }
}
