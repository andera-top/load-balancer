export type McpStatus = {
  enabled: boolean
  endpoint: string
  transport: string
  tools: Array<{
    name: string
    title?: string
    function: string
    available: boolean
    [key: string]: unknown
  }>
  [key: string]: unknown
}

let status: () => McpStatus = () => ({ enabled: false, endpoint: '/mcp', transport: 'streamable-http', tools: [] })
export function setMcpStatus(provider: () => McpStatus) {
  status = provider
}
export function getMcpStatus() {
  return status()
}
