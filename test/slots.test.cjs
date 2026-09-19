const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

test('health and WS refreshes cannot erase in-flight reservations or inflate free slots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'andera-slots-'))
  const file = path.join(root, 'workers.json')
  Object.assign(process.env, { LB_AUTH_KEY: 'lb-key', WORKERS_CONFIG_PATH: file, LOG_LEVEL: 'error' })
  // Keep this discovery/reservation test independent from the Redis processor.
  const processor = require.resolve('../dist/utils/taskProcessor')
  require.cache[processor] = { id: processor, filename: processor, loaded: true, exports: { updateWorkerConcurrency() {} } }
  const manager = require('../dist/utils/workerManager')
  let available = 1
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        group: 'web',
        contract: 1,
        status: 'ready',
        slots: { used: 1 - available, available, limit: 1 },
        functions: [{ name: 'hello', params: {} }],
        services: [],
      })
    )
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })
  const url = 'http://127.0.0.1:' + server.address().port
  await fs.writeFile(file, JSON.stringify([url]))
  await manager.discoverWorkers()
  assert.equal(manager.reserveSlot(url), true)
  manager.updateWorkerStatus(url, 'ready', { used: 0, available: 1, limit: 1 })
  assert.equal(manager.reserveSlot(url), false, 'A status frame must not erase a reservation')
  await manager.discoverWorkers()
  assert.equal(manager.reserveSlot(url), false, 'Discovery must not erase a reservation')
  manager.releaseSlot(url)
  manager.releaseSlot(url)
  assert.equal(manager.reserveSlot(url), true)
  assert.equal(manager.reserveSlot(url), false, 'Duplicate release must not manufacture capacity')
  manager.releaseSlot(url)
  available = 0
  await manager.discoverWorkers()
  assert.equal(manager.reserveSlot(url), false, 'HTTP discovery refreshes capacity without WS')
  available = 1
  await manager.discoverWorkers()
  assert.equal(manager.reserveSlot(url), true)
  manager.releaseSlot(url)
})
