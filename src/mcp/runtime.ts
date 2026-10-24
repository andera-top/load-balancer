import path from 'path'
import { LiveConfig, parseBalancerConfig, allows } from './config'
import { inputSchema, Parameter, toolName } from './schema'
import { createMcpRouter, dedicatedToken, describeTools, ExposedTool } from './transport'

export type McpWorker = {
  group?: string
  contract?: number
  status?: string
  contractValid?: boolean
  services?: { state: string }[]
  functions?: { name: string; description?: string; params: Record<string, Parameter> }[]
}
export function createBalancerMcp(options: {
  root: string
  env?: NodeJS.ProcessEnv
  workers: () => McpWorker[]
  dispatch: (payload: any, opts: { authorization: string; attempts: number }) => Promise<any>
  report?: (message: string) => void
}) {
  const env = options.env ?? process.env
  const config = new LiveConfig(path.resolve(options.root, env.MCP_CONFIG_PATH || 'mcp.json'), raw => parseBalancerConfig(raw, env), options.report)
  const token = dedicatedToken(env.MCP_AUTH_KEY, [env.LB_AUTH_KEY])
  if (env.MCP_AUTH_KEY && !token) options.report?.('MCP disabled: MCP_AUTH_KEY must contain no whitespace and differ from LB_AUTH_KEY')
  const enabled = () => !!token && config.current() !== undefined
  const tools = (): ExposedTool[] => {
    const settings = config.current()
    if (!token || !settings) return []
    const workers = options.workers().filter(worker => worker.contractValid !== false)
    const entries: ExposedTool[] = []
    for (const target of settings.targets) {
      const candidates = workers.filter(worker => worker.group === target.group && worker.contract === target.contract)
      const definitions = new Map(candidates.flatMap(worker => worker.functions || []).map(fn => [fn.name, fn]))
      for (const [name, definition] of definitions) {
        if (!allows(target, name)) continue
        const available = candidates.some(
          worker =>
            worker.status === 'ready' &&
            (!worker.services || worker.services.every(service => service.state === 'up')) &&
            worker.functions?.some(fn => fn.name === name)
        )
        entries.push({
          function: name,
          group: target.group,
          contract: target.contract,
          available,
          tool: {
            name: toolName(target.group, target.contract, name),
            title: name + ' (' + target.group + ' v' + target.contract + ')',
            description: definition.description || 'Execute ' + name + ' in ' + target.group + ' contract ' + target.contract,
            inputSchema: inputSchema(definition.params),
          },
          invoke: async args => {
            const current = config.current()?.targets.find(entry => entry.group === target.group && entry.contract === target.contract)
            if (!current || !allows(current, name)) throw new Error('Tool revoked')
            const key = env[current.workerAuthKeyEnv]
            if (!key || key === token) throw new Error('Missing or non-dedicated credential')
            const response = await options.dispatch(
              { group: current.group, contract: current.contract, function: name, input: args, mode: 'sync' },
              // Avoid duplicate side effects from automatic LB retries on MCP calls.
              { authorization: key, attempts: 1 }
            )
            if (!response || response.success !== true) throw new Error('Worker task failed')
            return response.result
          },
        })
      }
    }
    return entries.sort((a, b) => a.tool.name.localeCompare(b.tool.name))
  }
  const status = () => ({
    enabled: enabled(),
    endpoint: '/mcp',
    transport: 'streamable-http',
    authentication: 'bearer',
    authConfigured: !!token,
    ...config.status(),
    targets: (config.current()?.targets || []).map(({ group, contract, functions }) => ({ group, contract, functions })),
    tools: describeTools(tools()),
  })
  return {
    router: createMcpRouter({
      name: 'andera-load-balancer',
      token: () => token,
      enabled,
      tools,
      origins: (env.MCP_ALLOWED_ORIGINS || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean),
      report: options.report,
    }),
    status,
    close: () => config.close(),
  }
}
