const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const express = require('express')
const { WebSocketServer } = require('ws')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')

async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(check) {
  for (let i = 0; i < 160; i++) {
    try {
      if (await check()) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Server readiness timed out')
}
const hasRedis = spawnSync('redis-server', ['--version']).status === 0

test('actual LB + Redis: discovers, authenticates, dispatches and reports MCP safely', { skip: !hasRedis, timeout: 20000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'andera-lb-integration-'))
  const children = []
  const client = new Client({ name: 'lb-integration', version: '1' })
  let fakeHttp, wss
  t.after(async () => {
    await client.close().catch(() => {})
    for (const child of children.reverse())
      if (child.exitCode === null) {
        child.kill()
        await once(child, 'exit')
      }
    if (wss) {
      for (const ws of wss.clients) ws.terminate()
      await new Promise(resolve => wss.close(resolve))
    }
    if (fakeHttp) {
      fakeHttp.closeAllConnections()
      await new Promise(resolve => fakeHttp.close(resolve))
    }
    await fs.rm(root, { recursive: true, force: true })
  })
  const redisPort = await freePort(),
    lbPort = await freePort()
  children.push(
    spawn('redis-server', ['--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no', '--dir', root], { stdio: 'ignore' })
  )
  const LB_KEY = 'lb-integration-internal-key',
    WORKER_KEY = 'worker-integration-key',
    MCP_KEY = 'agent-integration-key'
  let requests = [],
    fail = false
  const fake = express()
  fake.use(express.json())
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(wss, 'listening')
  wss.on('connection', ws => ws.on('message', () => ws.send(JSON.stringify({ status: 'ready', slots: { used: 0, available: 1, limit: 1 } }))))
  const functions = [
    {
      name: 'hello',
      description: 'Integration LB greeting',
      params: { name: { type: 'string', required: true } },
      config: { supportsStreaming: true },
    },
  ]
  fake.get('/health', (req, res) => {
    assert.equal(req.headers['x-lb-auth'], LB_KEY)
    res.json({
      status: 'ready',
      group: 'web',
      contract: 1,
      functions,
      websocketPort: wss.address().port,
      slots: { used: 0, available: 1, limit: 1 },
      services: [],
    })
  })
  fake.post('/task', (req, res) => {
    requests.push({ headers: req.headers, body: req.body })
    if (req.headers.authorization !== WORKER_KEY || req.headers['x-lb-auth'] !== LB_KEY) return res.sendStatus(401)
    if (fail) return res.status(500).json({ error: 'Upstream error' })
    if (req.body.mode === 'stream') {
      res.type('text/plain').write('first')
      setTimeout(() => res.end('second'), 200)
      return
    }
    res.json({ success: true, result: { greeting: req.body.input.name } })
  })
  fake.get('/logs', (req, res) => {
    assert.equal(req.headers['x-lb-auth'], LB_KEY)
    res.json({ logs: ['integration log'] })
  })
  fakeHttp = await new Promise(resolve => {
    const server = fake.listen(0, '127.0.0.1', () => resolve(server))
  })
  await fs.writeFile(path.join(root, 'workers.json'), JSON.stringify(['http://127.0.0.1:' + fakeHttp.address().port]))
  await fs.writeFile(
    path.join(root, 'mcp.json'),
    JSON.stringify({ targets: [{ group: 'web', contract: 1, workerAuthKeyEnv: 'TEST_WORKER_KEY', functions: ['hello'] }] })
  )
  const env = {
    ...process.env,
    PORT: String(lbPort),
    LB_AUTH_KEY: LB_KEY,
    MCP_AUTH_KEY: MCP_KEY,
    TEST_WORKER_KEY: WORKER_KEY,
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: String(redisPort),
    WORKERS_CONFIG_PATH: path.join(root, 'workers.json'),
    MCP_CONFIG_PATH: path.join(root, 'mcp.json'),
    WORKER_DISCOVERY_INTERVAL: '100',
    WORKER_DISCOVERY_RETRIES: '0',
    WORKER_DISCOVERY_TIMEOUT: '200',
    WS_HEARTBEAT_INTERVAL: '100',
    WS_HEARTBEAT_TIMEOUT: '500',
    TASK_TIMEOUT: '3000',
    DASHBOARD_ENABLED: 'true',
    BULL_BOARD_ENABLED: 'false',
    LOG_LEVEL: 'error',
  }
  children.push(spawn(process.execPath, ['dist/app.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: 'ignore' }))
  const base = 'http://127.0.0.1:' + lbPort
  const auth = key => ({ Authorization: 'Bearer ' + key })
  await waitFor(async () => {
    const health = await (await fetch(base + '/health', { headers: auth(LB_KEY) })).json()
    return health.workers?.[0]?.status === 'ready' && health.mcp.tools.length === 1
  })
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal((await (await fetch(base + '/health')).json()).mcp, undefined)
  assert.equal((await (await fetch(base + '/health', { headers: auth(MCP_KEY) })).json()).mcp, undefined)
  const panelResponse = await fetch(base + '/dashboard/api/mcp')
  assert.equal(panelResponse.status, 200)
  assert.equal(panelResponse.headers.get('cache-control'), 'no-store')
  const panel = await panelResponse.json()
  assert.equal(panel.enabled, true)
  assert.equal(panel.toolCount, 1)
  assert.deepEqual(panel.tools, [{ title: 'hello (web v1)', available: true }])
  for (const privateField of ['authConfigured', 'configured', 'configError', 'loadedAt', 'targets', 'inputSchema']) {
    assert.ok(!JSON.stringify(panel).includes(privateField))
  }
  for (const secret of [MCP_KEY, LB_KEY, WORKER_KEY, 'TEST_WORKER_KEY']) assert.ok(!JSON.stringify(panel).includes(secret))
  const workerUrl = 'http://127.0.0.1:' + fakeHttp.address().port
  const encodedWorker = Buffer.from(workerUrl).toString('base64url')
  assert.deepEqual(await (await fetch(base + '/dashboard/api/workers/' + encodedWorker + '/logs')).json(), { logs: ['integration log'] })
  const untrustedUrl = 'http://127.0.0.1:' + (await freePort())
  const rejectedLogs = await fetch(base + '/dashboard/api/workers/' + Buffer.from(untrustedUrl).toString('base64url') + '/logs')
  assert.equal(rejectedLogs.status, 404)
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: auth(MCP_KEY) } }))
  const tool = (await client.listTools()).tools[0]
  const result = await client.callTool({ name: tool.name, arguments: { name: 'Ada' } })
  assert.deepEqual(result.structuredContent, { result: { greeting: 'Ada' } })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].headers.authorization, WORKER_KEY)
  assert.equal(requests[0].headers['x-lb-auth'], LB_KEY)
  assert.equal(requests[0].body.group, 'web')
  assert.equal(
    (
      await fetch(base + '/task', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      })
    ).status,
    401
  )
  const malformedTask = await fetch(base + '/task', {
    method: 'POST',
    headers: { ...auth(LB_KEY), 'x-wr-auth': WORKER_KEY, 'content-type': 'application/json' },
    body: '{',
  })
  assert.equal(malformedTask.status, 400)
  assert.deepEqual(await malformedTask.json(), { error: 'Invalid request' })
  const invalidTask = await fetch(base + '/task', {
    method: 'POST',
    headers: { ...auth(LB_KEY), 'x-wr-auth': WORKER_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ group: 'web', contract: '1', function: 'hello' }),
  })
  assert.equal(invalidTask.status, 400)
  const streamed = await fetch(base + '/task', {
    method: 'POST',
    headers: { ...auth(LB_KEY), 'x-wr-auth': WORKER_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ group: 'web', contract: 1, function: 'hello', input: { name: 'Stream' }, mode: 'stream' }),
  })
  const queued = fetch(base + '/task', {
    method: 'POST',
    headers: { ...auth(LB_KEY), 'x-wr-auth': WORKER_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ group: 'web', contract: 1, function: 'hello', input: { name: 'Queued' }, mode: 'sync' }),
  })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(requests.length, 2, 'The stream keeps its only Worker slot until the response ends')
  assert.equal(await streamed.text(), 'firstsecond')
  assert.deepEqual(await (await queued).json(), { success: true, result: { greeting: 'Queued' } })
  assert.equal(requests.length, 3)
  fail = true
  const started = Date.now()
  const failure = await client.callTool({ name: tool.name, arguments: { name: 'Error' } })
  assert.equal(failure.isError, true)
  assert.ok(Date.now() - started < 2000, 'Failure must settle before the task timeout')
  assert.equal(requests.length, 4, 'MCP calls are not automatically retried by the LB')
  await fs.writeFile(path.join(root, 'mcp.json'), JSON.stringify({ targets: [] }))
  assert.deepEqual((await client.listTools()).tools, [])
  assert.equal((await client.callTool({ name: tool.name, arguments: { name: 'Denied' } })).isError, true)
  assert.equal(requests.length, 4)
})
