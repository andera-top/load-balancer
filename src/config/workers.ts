import fs from 'fs'
import path from 'path'
import { error } from '../utils/logger'

export type WorkerUrl = string

const WORKERS_PATH = path.resolve(__dirname, '../../workers.json')

export function loadWorkersConfig(): WorkerUrl[] {
  try {
    const raw = fs.readFileSync(WORKERS_PATH, 'utf-8')
    const workers = JSON.parse(raw)
    if (!Array.isArray(workers) || !workers.every(w => typeof w === 'string')) throw new Error('Invalid workers.json format')
    return workers
  } catch (err) {
    error('[LB]', 'Failed to load workers.json:', err)
    return []
  }
}
