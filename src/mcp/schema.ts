import { createHash } from 'crypto'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export type Parameter = {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  required?: boolean
  default?: unknown
  enum?: unknown[]
  pattern?: string
  min?: number
  max?: number
}
export function inputSchema(params: Record<string, Parameter>): Tool['inputSchema'] {
  const properties: Record<string, any> = Object.create(null)
  const required: string[] = []
  for (const [name, rule] of Object.entries(params)) {
    const property: Record<string, unknown> = { type: rule.type }
    if (rule.description) property.description = rule.description
    if (rule.default !== undefined) property.default = rule.default
    if (rule.enum) property.enum = rule.enum
    if (rule.pattern && rule.type === 'string') property.pattern = rule.pattern
    if (rule.type === 'array') property.items = {}
    const limits =
      rule.type === 'number'
        ? ['minimum', 'maximum']
        : rule.type === 'string'
          ? ['minLength', 'maxLength']
          : rule.type === 'array'
            ? ['minItems', 'maxItems']
            : []
    if (limits.length && rule.min !== undefined) property[limits[0]] = rule.min
    if (limits.length && rule.max !== undefined) property[limits[1]] = rule.max
    properties[name] = property
    if (rule.required) required.push(name)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}
/** Stable even when other groups are added; the suffix disambiguates normalization/truncation. */
export function toolName(group: string, contract: number, name: string): string {
  const identity = JSON.stringify([group, contract, name])
  const prefix = (group + '_v' + contract + '_' + name).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 51)
  return prefix + '_' + createHash('sha256').update(identity).digest('hex').slice(0, 12)
}
export function localToolName(name: string): string {
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(name) ? name : toolName('worker', 1, name)
}
