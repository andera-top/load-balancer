import fs from 'fs'
import path from 'path'
import { error } from '../utils/logger'

export type WorkerUrl = string

export const WORKERS_PATH = process.env.WORKERS_CONFIG_PATH ? path.resolve(process.env.WORKERS_CONFIG_PATH) : path.resolve(__dirname, '../../workers.json')
let lastValidWorkers: WorkerUrl[] = []

function isWorkerUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value !== value.trim()) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

export function loadWorkersConfig(): WorkerUrl[] {
  try {
    const raw = fs.readFileSync(WORKERS_PATH, 'utf-8')
    const workers = JSON.parse(raw)
    if (!Array.isArray(workers) || !workers.every(isWorkerUrl)) throw new Error('Invalid workers.json format')
    lastValidWorkers = workers
    return [...workers]
  } catch (err) {
    error('[LB]', 'Failed to load workers.json:', err)
    return [...lastValidWorkers]
  }
}
