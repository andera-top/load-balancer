import axios from 'axios'
import { loadWorkersConfig, WorkerUrl } from '../config/workers'
import { config } from '../config'
import { log, warn } from './logger'
import { updateWorkerConcurrency } from './taskProcessor'

export type DiscoveredWorker = {
  url: string
  websocketPort?: number
  group?: string
  contract?: number
  status?: string
  slots?: {
    used: number
    available: number
    limit: number
    queue: number
  }
  system?: {
    cpuLoad: number
    usedMemoryPercent: number
  }
  functions?: { name: string; params: any }[]
  contractValid?: boolean
  contractMismatchReason?: string
  tags?: string[]
  services?: { state: string }[]
}

let workers: DiscoveredWorker[] = []
let previousWorkers: DiscoveredWorker[] = []
let localSlots: Record<string, number> = {}

function workerKey(w: DiscoveredWorker) {
  return w.url
}

function findWorker(arr: DiscoveredWorker[], url: string) {
  return arr.find(w => w.url === url)
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function validateWorkerContracts(workers: DiscoveredWorker[]) {
  const byGroupContract: Record<string, DiscoveredWorker[]> = {}
  for (const w of workers) {
    if (!w.group || !w.contract) continue
    const key = `${w.group}::${w.contract}`
    if (!byGroupContract[key]) byGroupContract[key] = []
    byGroupContract[key].push(w)
  }
  for (const key in byGroupContract) {
    const groupWorkers = byGroupContract[key]
    if (groupWorkers.length === 0) continue
    const ref = groupWorkers[0].functions
    for (const w of groupWorkers) {
      const wasValid = w.contractValid !== false
      if (!deepEqual(w.functions, ref)) {
        w.contractValid = false
        w.contractMismatchReason = 'Contract mismatch (functions/params)'
        if (wasValid) {
          warn('[LB]', `Worker ${w.url} marked as invalid: contract mismatch (group: ${w.group}, contract: ${w.contract})`)
        }
      } else {
        w.contractValid = true
        w.contractMismatchReason = undefined
      }
    }
  }
}

async function getHealthWithRetry(url: string, retries: number, timeout: number) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      const healthUrl = url.endsWith('/') ? url + 'health' : url + '/health'
      const res = await axios.get(healthUrl, {
        headers: { 'x-lb-auth': config.lbAuthKey },
        timeout,
      })
      return res.data
    } catch (err) {
      lastErr = err
      if (i < retries) {
        await new Promise(r => setTimeout(r, 200))
      }
    }
  }
  throw lastErr
}

export async function discoverWorkers() {
  const baseWorkers = loadWorkersConfig()
  const uniqueUrls = Array.from(new Set(baseWorkers))
  const discovered: DiscoveredWorker[] = []
  for (const url of uniqueUrls) {
    try {
      const data = await getHealthWithRetry(url, config.workerDiscoveryRetries, config.workerDiscoveryTimeout)
      discovered.push({
        url,
        websocketPort: data.websocketPort,
        group: data.group,
        contract: data.contract,
        status: data.status,
        slots: data.slots,
        system: data.system,
        functions: data.functions,
        tags: data.tags,
        services: data.services,
      })
    } catch (err: any) {
      discovered.push({ url, status: 'unreachable' })
    }
  }

  for (const w of discovered) {
    if (!findWorker(previousWorkers, w.url)) {
      log('[LB]', `Worker added: ${w.url} (ws:${w.websocketPort}) [group:${w.group}] [contract:${w.contract}] [status:${w.status}]`)
    }
  }

  for (const w of previousWorkers) {
    if (!findWorker(discovered, w.url)) {
      log('[LB]', `Worker removed: ${w.url}`)
    }
  }

  for (const w of discovered) {
    const prev = findWorker(previousWorkers, w.url)
    if (prev) {
      if (prev.status !== w.status) {
        log('[LB]', `Worker status changed: ${w.url} [${prev.status} -> ${w.status}]`)
      }
      if (prev.contract !== w.contract) {
        log('[LB]', `Worker contract changed: ${w.url} [${prev.contract} -> ${w.contract}]`)
      }
      if (prev.group !== w.group) {
        log('[LB]', `Worker group changed: ${w.url} [${prev.group} -> ${w.group}]`)
      }
    }
  }

  for (const w of discovered) {
    const prev = previousWorkers.find(pw => pw.url === w.url)
    if (prev) {
      w.contractValid = prev.contractValid
      w.contractMismatchReason = prev.contractMismatchReason
    }
  }

  previousWorkers = discovered
  workers = discovered
  validateWorkerContracts(workers)
  updateWorkerConcurrency()
}

export function getDiscoveredWorkers(): DiscoveredWorker[] {
  return workers.filter(w => w.contractValid !== false)
}

export function getInvalidWorkers(): DiscoveredWorker[] {
  return workers.filter(w => w.contractValid === false)
}

export function syncLocalSlots(url: string, available: number) {
  localSlots[url] = available
}

export function reserveSlot(url: string): boolean {
  if (localSlots[url] === undefined) return false
  if (localSlots[url] <= 0) return false
  localSlots[url]--
  return true
}

export function releaseSlot(url: string) {
  if (localSlots[url] === undefined) return
  localSlots[url]++
}

export function updateWorkerStatus(url: string, status?: string, slots?: any, system?: { cpuLoad: number; usedMemoryPercent: number }) {
  const worker = workers.find(w => w.url === url)
  if (worker) {
    if (status !== undefined) worker.status = status
    if (slots !== undefined) {
      worker.slots = { ...worker.slots, ...slots }
      if (typeof slots.available === 'number') {
        localSlots[url] = slots.available
      }
    }
    if (system !== undefined) worker.system = { ...system }
    updateWorkerConcurrency()
  }
}

export function selectBestWorker({ group, contract, function: fnName }: { group: string; contract: number; function: string }) {
  const candidates = getDiscoveredWorkers().filter(
    w =>
      w.status === 'ready' &&
      w.group === group &&
      w.contract === contract &&
      w.slots &&
      (localSlots[w.url] ?? w.slots.available) > 0 &&
      w.functions &&
      w.functions.some(f => f.name === fnName) &&
      (!w.services || w.services.length === 0 || w.services.every((s: any) => s.state === 'up'))
  )
  if (candidates.length === 0) return null
  function score(w: any) {
    const slots = localSlots[w.url] ?? w.slots?.available ?? 0
    const cpu = w.system?.cpuLoad ?? 0
    const mem = w.system?.usedMemoryPercent ?? 0
    return slots * 10 - cpu * 5 - mem * 5
  }
  candidates.sort((a, b) => score(b) - score(a))
  return candidates[0]
}
