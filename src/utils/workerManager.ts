import axios from 'axios'
import { loadWorkersConfig, WorkerUrl } from '../config/workers'
import { config } from '../config'
import { log, warn } from './logger'
import { updateWorkerConcurrency } from './taskProcessor'
import { contractSignature } from './workerContracts'

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
  functions?: { name: string; description?: string; params: any; config?: { supportsStreaming?: boolean } }[]
  contractValid?: boolean
  contractMismatchReason?: string
  tags?: string[]
  services?: { state: string }[]
}

let workers: DiscoveredWorker[] = []
let previousWorkers: DiscoveredWorker[] = []
let localSlots: Record<string, number> = {}
const reservations = new Map<string, number>()
let discoveryPromise: Promise<void> | null = null

function workerKey(w: DiscoveredWorker) {
  return w.url
}

function findWorker(arr: DiscoveredWorker[], url: string) {
  return arr.find(w => w.url === url)
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
      if (contractSignature(w.functions) !== contractSignature(ref)) {
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
        maxRedirects: 0,
        maxContentLength: 2 * 1024 * 1024,
      })
      const data = res.data
      validateHealth(data)
      return data
    } catch (err) {
      lastErr = err
      if (i < retries) {
        await new Promise(r => setTimeout(r, 200))
      }
    }
  }
  throw lastErr
}

function validateHealth(data: any) {
  if (
    !data ||
    typeof data !== 'object' ||
    typeof data.group !== 'string' ||
    !data.group.trim() ||
    !Number.isSafeInteger(data.contract) ||
    data.contract < 1 ||
    typeof data.status !== 'string' ||
    !data.slots ||
    !['used', 'available', 'limit'].every(key => Number.isSafeInteger(data.slots[key]) && data.slots[key] >= 0) ||
    data.slots.limit < 1 ||
    data.slots.available > data.slots.limit ||
    data.slots.used > data.slots.limit ||
    !Array.isArray(data.functions) ||
    (data.websocketPort !== undefined && (!Number.isInteger(data.websocketPort) || data.websocketPort < 1 || data.websocketPort > 65535)) ||
    (data.services !== undefined && (!Array.isArray(data.services) || data.services.some((s: any) => !s || typeof s.state !== 'string')))
  )
    throw new Error('Invalid Worker health metadata')
  const names = new Set<string>()
  for (const fn of data.functions) {
    if (!fn || typeof fn.name !== 'string' || !fn.name || names.has(fn.name) || !fn.params || typeof fn.params !== 'object' || Array.isArray(fn.params)) {
      throw new Error('Invalid Worker function metadata')
    }
    names.add(fn.name)
    for (const rule of Object.values(fn.params) as any[]) {
      if (!rule || typeof rule !== 'object' || !['string', 'number', 'boolean', 'object', 'array'].includes(rule.type)) {
        throw new Error('Invalid Worker parameter metadata')
      }
    }
  }
}

async function runDiscovery() {
  const baseWorkers = loadWorkersConfig()
  const uniqueUrls = Array.from(new Set(baseWorkers))
  const discovered: DiscoveredWorker[] = await Promise.all(
    uniqueUrls.map(async url => {
      try {
        const data = await getHealthWithRetry(url, config.workerDiscoveryRetries, config.workerDiscoveryTimeout)
        return {
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
        }
      } catch {
        return { url, status: 'unreachable' }
      }
    })
  )

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
  const currentUrls = new Set(workers.map(worker => worker.url))
  for (const url of Object.keys(localSlots)) if (!currentUrls.has(url)) delete localSlots[url]
  for (const worker of workers) {
    if (typeof worker.slots?.available === 'number') {
      localSlots[worker.url] = worker.slots.available
    }
  }
  validateWorkerContracts(workers)
  updateWorkerConcurrency()
}

export function discoverWorkers(): Promise<void> {
  if (discoveryPromise) return discoveryPromise
  discoveryPromise = runDiscovery().finally(() => {
    discoveryPromise = null
  })
  return discoveryPromise
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

function availableSlots(url: string, limit = workers.find(worker => worker.url === url)?.slots?.limit ?? 0): number {
  return Math.max(0, Math.min(localSlots[url] ?? 0, limit - (reservations.get(url) ?? 0)))
}

export function reserveSlot(url: string): boolean {
  if (availableSlots(url) <= 0) return false
  reservations.set(url, (reservations.get(url) ?? 0) + 1)
  localSlots[url]--
  return true
}

export function releaseSlot(url: string) {
  const count = reservations.get(url) ?? 0
  if (!count) return
  if (count <= 1) reservations.delete(url)
  else reservations.set(url, count - 1)
  if (localSlots[url] !== undefined) {
    const limit = workers.find(worker => worker.url === url)?.slots?.limit ?? 0
    localSlots[url] = Math.min(localSlots[url] + 1, limit - (reservations.get(url) ?? 0))
  }
}

export function updateWorkerStatus(
  url: string,
  status?: string,
  slots?: any,
  system?: { cpuLoad: number; usedMemoryPercent: number },
  services?: { state: string }[]
) {
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
    if (services !== undefined) worker.services = services
    updateWorkerConcurrency()
  }
}

type TaskSelection = { group: string; contract: number; function: string; mode?: string }
function matchingWorkers({ group, contract, function: fnName, mode }: TaskSelection) {
  return getDiscoveredWorkers().filter(
    w =>
      w.status === 'ready' &&
      w.group === group &&
      w.contract === contract &&
      w.slots &&
      w.functions &&
      // Older Workers do not publish this capability. Preserve rolling-upgrade
      // compatibility, while excluding new Workers that explicitly say false.
      w.functions.some(f => f.name === fnName && (mode !== 'stream' || f.config?.supportsStreaming !== false)) &&
      (!w.services || w.services.length === 0 || w.services.every((s: any) => s.state === 'up'))
  )
}

export function hasMatchingWorker(selection: TaskSelection): boolean {
  return matchingWorkers(selection).length > 0
}

export function selectBestWorker(selection: TaskSelection) {
  const candidates = matchingWorkers(selection).filter(worker => availableSlots(worker.url, worker.slots?.limit) > 0)
  if (candidates.length === 0) return null
  function score(w: any) {
    const slots = availableSlots(w.url, w.slots?.limit)
    const cpu = w.system?.cpuLoad ?? 0
    const mem = w.system?.usedMemoryPercent ?? 0
    return slots * 10 - cpu * 5 - mem * 5
  }
  candidates.sort((a, b) => score(b) - score(a))
  return candidates[0]
}
