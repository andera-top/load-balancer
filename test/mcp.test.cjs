const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const express = require('express')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { LiveConfig, parseWorkerConfig, parseBalancerConfig } = require('../dist/mcp/config')
const { inputSchema, toolName } = require('../dist/mcp/schema')
const { dedicatedToken } = require('../dist/mcp/transport')
const isBalancer = require('../package.json').name.includes('load-balancer')
const createRuntime = isBalancer ? require('../dist/mcp/runtime').createBalancerMcp : require('../dist/mcp/runtime').createWorkerMcp

const TOKEN = 'test-mcp-token-distinct-from-internal-keys'
const WORKER_KEY = 'test-worker-key'
const LB_KEY = 'test-lb-key'
const env = {
  MCP_AUTH_KEY: TOKEN,
  MCP_ALLOWED_ORIGINS: 'https://trusted.example',
  AUTH_KEY: WORKER_KEY,
  LB_AUTH_KEY: LB_KEY,
  WORKER_KEY,
  CONTRACT: '1',
}
const definition = {
  description: 'Greet a person',
  params: { name: { type: 'string', required: true, min: 2, description: 'Person name' } },
  handler: async args => ({ message: args.name }),
}
function settings(functions) {
  const selected = functions === undefined ? {} : { functions }
  return isBalancer ? { targets: [{ group: 'web', contract: 1, workerAuthKeyEnv: 'WORKER_KEY', ...selected }] } : selected
}
async function fixture(t, initial = settings()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'andera-mcp-test-'))
  const filename = path.join(root, 'mcp.json')
  if (initial !== null) await fs.writeFile(filename, JSON.stringify(initial))
  let calls = []
  let fail = false
  let available = true
  const functions = new Map([
    ['hello', definition],
    ['hidden', { ...definition, description: 'Private operation' }],
  ])
  const runtime = createRuntime({
    root,
    env,
    functions: () => functions,
    available: () => available,
    workers: () => [
      { group: 'web', contract: 1, status: available ? 'ready' : 'maintenance', functions: Array.from(functions, ([name, def]) => ({ name, ...def })) },
    ],
    execute: async payload => {
      calls.push(payload)
      if (fail) throw new Error('secret: ' + WORKER_KEY)
      return { greeting: payload.input.name }
    },
    dispatch: async (payload, options) => {
      calls.push({ payload, options })
      if (fail) throw new Error('secret: ' + WORKER_KEY)
      return { success: true, result: { greeting: payload.input.name } }
    },
  })
  const app = express()
  app.use('/mcp', runtime.router)
  const server = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server))
  })
  const url = 'http://127.0.0.1:' + server.address().port + '/mcp'
  const client = new Client({ name: 'andera-test', version: '1' })
  const connect = () => client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: 'Bearer ' + TOKEN } } }))
  t.after(async () => {
    await client.close().catch(() => {})
    await runtime.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })
  return {
    client,
    runtime,
    connect,
    url,
    filename,
    calls,
    fail: () => {
      fail = true
    },
    unavailable: () => {
      available = false
    },
  }
}

test('configuration is strict and secrets stay out of parsed configuration', () => {
  assert.deepEqual(parseWorkerConfig({}), {})
  assert.deepEqual(parseWorkerConfig({ functions: [] }), { functions: [] })
  for (const raw of [null, [], { functions: null }, { functions: ['a', 'a'] }, { functions: [' a'] }, { function: ['a'] }])
    assert.throws(() => parseWorkerConfig(raw))
  const input = { targets: [{ group: 'web', contract: 1, workerAuthKeyEnv: 'WORKER_KEY' }] }
  const parsed = parseBalancerConfig(input, env)
  assert.ok(!JSON.stringify(parsed).includes(WORKER_KEY))
  assert.throws(() => parseBalancerConfig(input, {}))
  assert.throws(() => parseBalancerConfig({ targets: [...input.targets, ...input.targets] }, env))
  assert.throws(() => parseBalancerConfig({ targets: [{ ...input.targets[0], contract: 0 }] }, env))
  assert.throws(() => parseBalancerConfig({ targets: [{ ...input.targets[0], group: ' web' }] }, env))
  assert.equal(dedicatedToken(WORKER_KEY, [WORKER_KEY]), '')
  assert.equal(dedicatedToken(TOKEN, [WORKER_KEY]), TOKEN)
  assert.equal(dedicatedToken(' ' + WORKER_KEY, [WORKER_KEY]), '')
  assert.equal(dedicatedToken(WORKER_KEY, [' ' + WORKER_KEY + ' ']), '')
  assert.throws(() => parseBalancerConfig(input, { ...env, WORKER_KEY: ' ' + TOKEN + ' ' }))
  assert.throws(() => parseBalancerConfig(input, { ...env, WORKER_KEY: LB_KEY }))
})

test('schemas preserve parameter constraints and names remain unique', () => {
  const schema = inputSchema({
    text: { type: 'string', min: 2, max: 5 },
    list: { type: 'array', min: 1, max: 3 },
    number: { type: 'number', min: 0, required: true },
  })
  assert.equal(schema.properties.list.minItems, 1)
  assert.equal(schema.properties.list.maxItems, 3)
  assert.equal(schema.properties.text.minLength, 2)
  assert.equal(schema.properties.number.minimum, 0)
  assert.deepEqual(schema.required, ['number'])
  assert.equal(schema.additionalProperties, false)
  assert.notEqual(toolName('a/b', 1, 'hello'), toolName('a_b', 1, 'hello'))
  assert.notEqual(toolName('a', 1, 'b_v2_c'), toolName('a_v1_b', 2, 'c'))
  assert.ok(toolName('a'.repeat(100), 1, 'hello').length <= 64)
})

test('real SDK discovers and calls tools with a single dedicated bearer', async t => {
  const f = await fixture(t, settings(['hello']))
  for (const token of ['', LB_KEY, WORKER_KEY]) {
    const response = await fetch(f.url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 401)
  }
  const crossOrigin = await fetch(f.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(crossOrigin.status, 403)
  const preflight = await fetch(f.url, {
    method: 'OPTIONS',
    headers: { Origin: 'https://trusted.example', 'Access-Control-Request-Method': 'POST' },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://trusted.example')
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/)
  await f.connect()
  const { tools } = await f.client.listTools()
  assert.equal(tools.length, 1)
  assert.equal(tools[0].description, definition.description)
  const result = await f.client.callTool({ name: tools[0].name, arguments: { name: 'Ada' } })
  assert.deepEqual(result.structuredContent, { result: { greeting: 'Ada' } })
  assert.equal(f.calls.length, 1)
  if (isBalancer) {
    assert.equal(f.calls[0].payload.group, 'web')
    assert.equal(f.calls[0].payload.contract, 1)
    assert.equal(f.calls[0].options.authorization, WORKER_KEY)
    assert.equal(f.calls[0].options.attempts, 1)
    assert.ok(!JSON.stringify(f.calls[0].payload).includes(WORKER_KEY))
  }
  for (const args of [{}, { name: 'A' }, { name: 'Ada', group: 'another-group' }]) {
    const result = await f.client.callTool({ name: tools[0].name, arguments: args })
    assert.equal(result.isError, true)
  }
  assert.equal(f.calls.length, 1)
  const status = JSON.stringify(f.runtime.status())
  for (const secret of [TOKEN, WORKER_KEY, LB_KEY]) assert.ok(!status.includes(secret))
  assert.ok(!status.includes('workerAuthKeyEnv'))
})

test('hot reload revokes cached tools, preserves valid config on bad edits, and disables on deletion', async t => {
  const f = await fixture(t)
  await f.connect()
  const original = (await f.client.listTools()).tools
  assert.equal(original.length, 2)
  await fs.writeFile(f.filename, JSON.stringify(settings([])))
  assert.deepEqual((await f.client.listTools()).tools, [])
  assert.equal((await f.client.callTool({ name: original[0].name, arguments: { name: 'Ada' } })).isError, true)
  assert.equal(f.calls.length, 0)
  await fs.writeFile(f.filename, '{"unfinished":')
  assert.deepEqual((await f.client.listTools()).tools, [])
  assert.match(f.runtime.status().configError, /Invalid JSON/)
  const replacement = f.filename + '.new'
  await fs.writeFile(replacement, JSON.stringify(settings(['hello'])))
  await fs.rename(replacement, f.filename)
  assert.equal((await f.client.listTools()).tools.length, 1)
  assert.equal(f.runtime.status().configError, null)
  await fs.writeFile(f.filename, ' '.repeat(65537))
  assert.equal((await f.client.listTools()).tools.length, 1)
  assert.match(f.runtime.status().configError, /64 KiB/)
  await fs.writeFile(f.filename, JSON.stringify(settings(['hello'])))
  assert.equal((await f.client.listTools()).tools.length, 1)
  assert.equal(f.runtime.status().configError, null)
  await fs.unlink(f.filename)
  assert.equal((await fetch(f.url, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN } })).status, 404)
  await fs.writeFile(f.filename, JSON.stringify(settings()))
  assert.equal((await f.client.listTools()).tools.length, 2)
})

test('missing and malformed startup configurations are disabled', async t => {
  const f = await fixture(t, null)
  assert.equal(f.runtime.status().enabled, false)
  await fs.writeFile(f.filename, '{"token":"must-not-be-logged"')
  const status = f.runtime.status()
  assert.equal(status.enabled, false)
  assert.ok(!JSON.stringify(status).includes('must-not-be-logged'))
})

test('execution failures are safe and unavailable tools do not run', async t => {
  const f = await fixture(t, settings(['hello']))
  await f.connect()
  const tool = (await f.client.listTools()).tools[0]
  f.fail()
  const failed = await f.client.callTool({ name: tool.name, arguments: { name: 'Ada' } })
  assert.equal(failed.isError, true)
  assert.ok(!JSON.stringify(failed).includes(WORKER_KEY))
  f.unavailable()
  assert.equal((await f.client.callTool({ name: tool.name, arguments: { name: 'Ada' } })).isError, true)
  assert.equal(f.calls.length, 1)
})
