import express from 'express'
import { createHash, timingSafeEqual } from 'crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'

export type ExposedTool = {
  tool: Tool
  available: boolean
  group?: string
  contract?: number
  function: string
  invoke: (args: Record<string, unknown>) => Promise<unknown>
}
export type McpAdapter = {
  name: string
  token: () => string
  enabled: () => boolean
  tools: () => ExposedTool[]
  origins?: string[]
  report?: (message: string) => void
}
export function dedicatedToken(value: string | undefined, internalKeys: (string | undefined)[]): string {
  if (!value || /\s/.test(value)) return ''
  return internalKeys.some(key => key?.trim() === value) ? '' : value
}
function authorized(header: string | undefined, token: string): boolean {
  if (!token || !header?.startsWith('Bearer ')) return false
  const hash = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(header.slice(7)), hash(token))
}
function toolError(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}
export function createMcpRouter(adapter: McpAdapter): express.Router {
  const router = express.Router()
  let activeCalls = 0
  // Cache by content because each catalog refresh creates new schema objects.
  // Rotate the provider as well as our cache to bound AJV's internal cache.
  let validator = new AjvJsonSchemaValidator()
  const validators = new Map<string, ReturnType<AjvJsonSchemaValidator['getValidator']>>()
  function validate(schema: Tool['inputSchema'], args: Record<string, unknown>) {
    const key = JSON.stringify(schema)
    let compiled = validators.get(key)
    if (!compiled) {
      if (validators.size >= 128) {
        validators.clear()
        validator = new AjvJsonSchemaValidator()
      }
      compiled = validator.getValidator(schema)
      validators.set(key, compiled)
    }
    return compiled(args)
  }
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!adapter.enabled() || !adapter.token()) return res.status(404).json({ error: 'MCP is disabled' })
    // Native MCP clients omit Origin. Browser origins must be explicitly allowed.
    const origin = req.headers.origin
    if (origin && !adapter.origins?.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' })
    if (origin) {
      res.vary('Origin')
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID')
      res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id')
      if (req.method === 'OPTIONS') return res.sendStatus(204)
    }
    if (!authorized(req.headers.authorization, adapter.token())) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="Andera MCP"')
      return res.status(401).json({ error: 'Unauthorized' })
    }
    next()
  })
  router.post('/', express.json({ limit: '1mb' }), async (req, res) => {
    // Per-request server and transport: no shared session state or cached permissions.
    const server = new Server({ name: adapter.name, version: '1.0.0' }, { capabilities: { tools: {} }, jsonSchemaValidator: validator })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: adapter.tools().map(entry => entry.tool) }))
    server.setRequestHandler(CallToolRequestSchema, async request => {
      if (!adapter.enabled()) return toolError('MCP is disabled')
      const entry = adapter.tools().find(entry => entry.tool.name === request.params.name)
      if (!entry) return toolError('Tool is not available or is no longer allowed')
      if (!entry.available) return toolError('No ready Worker is available for this tool')
      const args = request.params.arguments ?? {}
      if (activeCalls >= 32) return toolError('MCP is busy; try again later')
      let result
      try {
        result = validate(entry.tool.inputSchema, args)
      } catch {
        adapter.report?.('MCP tool schema is invalid')
        return toolError('Tool schema is invalid')
      }
      if (!result.valid) return toolError('Invalid arguments: ' + result.errorMessage)
      activeCalls++
      try {
        const output = await entry.invoke(args)
        const text = JSON.stringify(output ?? null)
        if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) return toolError('Result exceeds the 1 MiB MCP limit')
        return { content: [{ type: 'text' as const, text }], structuredContent: { result: output ?? null } }
      } catch {
        adapter.report?.('MCP tool execution failed')
        // Do not serialize upstream HTTP errors, whose config may contain credentials.
        return toolError('Function execution failed or timed out')
      } finally {
        activeCalls--
      }
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void server.close().catch(() => {})
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch {
      adapter.report?.('MCP protocol request failed')
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' })
    }
  })
  router.all('/', (_req, res) => {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Only POST is supported by this stateless MCP endpoint' })
  })
  router.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error)
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid MCP request body' })
  })
  return router
}
export function describeTools(entries: ExposedTool[]) {
  return entries.map(({ tool, available, group, contract, function: fn }) => ({ ...tool, available, group, contract, function: fn }))
}
