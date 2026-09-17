import fs from 'fs'
import chokidar from 'chokidar'

export type Selection = { functions?: string[] }
export type Target = Selection & { group: string; contract: number; workerAuthKeyEnv: string }
export type WorkerMcpConfig = Selection
export type BalancerMcpConfig = { targets: Target[] }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown configuration field')
}
function selection(value: Record<string, unknown>): Selection {
  if (!Object.prototype.hasOwnProperty.call(value, 'functions')) return {}
  if (
    !Array.isArray(value.functions) ||
    value.functions.some(fn => typeof fn !== 'string' || !fn.trim() || fn !== fn.trim()) ||
    new Set(value.functions).size !== value.functions.length
  )
    throw new Error('Invalid functions allowlist')
  return { functions: value.functions as string[] }
}
export function parseWorkerConfig(value: unknown): WorkerMcpConfig {
  const data = object(value)
  keys(data, ['functions'])
  return selection(data)
}
export function parseBalancerConfig(value: unknown, env: NodeJS.ProcessEnv = process.env): BalancerMcpConfig {
  const data = object(value)
  keys(data, ['targets'])
  if (!Array.isArray(data.targets)) throw new Error('Expected targets array')
  const identities = new Set<string>()
  const targets = data.targets.map(raw => {
    const target = object(raw)
    keys(target, ['group', 'contract', 'workerAuthKeyEnv', 'functions'])
    if (
      typeof target.group !== 'string' ||
      !target.group.trim() ||
      target.group !== target.group.trim() ||
      !Number.isSafeInteger(target.contract) ||
      (target.contract as number) < 1 ||
      typeof target.workerAuthKeyEnv !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target.workerAuthKeyEnv)
    ) {
      throw new Error('Invalid target definition')
    }
    const key = env[target.workerAuthKeyEnv]
    if (!key?.trim()) throw new Error('A target credential environment variable is missing')
    if (key.trim() === env.MCP_AUTH_KEY?.trim() || key.trim() === env.LB_AUTH_KEY?.trim()) {
      throw new Error('Target credentials must be distinct from MCP_AUTH_KEY and LB_AUTH_KEY')
    }
    const identity = JSON.stringify([target.group, target.contract])
    if (identities.has(identity)) throw new Error('Duplicate group/contract target')
    identities.add(identity)
    return { group: target.group, contract: target.contract as number, workerAuthKeyEnv: target.workerAuthKeyEnv, ...selection(target) }
  })
  return { targets }
}
export function allows(selection: Selection, name: string): boolean {
  return selection.functions === undefined || selection.functions.includes(name)
}

/** Small local configuration only; never persist resolved secrets in this object. */
export class LiveConfig<T> {
  private value: T | undefined
  private raw: string | undefined
  private lastError: string | null = null
  private loadedAt: string | null = null
  private watcher: ReturnType<typeof chokidar.watch>
  constructor(
    readonly filename: string,
    private parse: (value: unknown) => T,
    private report: (message: string) => void = () => {}
  ) {
    this.reload()
    this.watcher = chokidar.watch(filename, { ignoreInitial: true, persistent: false, atomic: true })
    this.watcher.on('all', () => this.reload()).on('error', () => this.setError('Unable to watch mcp.json'))
  }
  private setError(message: string) {
    if (this.lastError !== message) this.report(message)
    this.lastError = message
  }
  reload() {
    try {
      if (fs.statSync(this.filename).size > 65536) {
        this.raw = undefined
        throw new Error('Configuration exceeds 64 KiB')
      }
      const raw = fs.readFileSync(this.filename, 'utf8')
      if (raw === this.raw) return
      // Cache rejected content too, so an invalid edit does not flood logs.
      this.raw = raw
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error('Invalid JSON in mcp.json')
      }
      this.value = this.parse(parsed)
      this.lastError = null
      this.loadedAt = new Date().toISOString()
      this.report('MCP configuration loaded')
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.value = undefined
        this.raw = undefined
        this.lastError = null
        this.loadedAt = null
      } else {
        // Revalidate restored content after an I/O failure, even if it is unchanged.
        if (error.code) this.raw = undefined
        // Only our validation errors are safe to expose; filesystem errors can contain paths.
        this.setError(error.code ? 'Unable to read mcp.json' : error.message)
      }
    }
  }
  current(): T | undefined {
    // Enforce edits/deletion before a request even if the filesystem event has not fired yet.
    this.reload()
    return this.value
  }
  status() {
    this.reload()
    return { configured: this.value !== undefined, loadedAt: this.loadedAt, configError: this.lastError }
  }
  close() {
    return this.watcher.close()
  }
}
