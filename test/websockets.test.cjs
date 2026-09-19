const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

test('late callbacks from a replaced Worker socket cannot alter the replacement', t => {
  process.env.LB_AUTH_KEY = 'socket-test-key'
  process.env.LOG_LEVEL = 'error'
  const instances = []
  class FakeSocket extends EventEmitter {
    static OPEN = 1
    readyState = 1
    constructor() {
      super()
      instances.push(this)
    }
    send() {}
    terminate() {
      this.readyState = 3
    }
  }
  const wsPath = require.resolve('ws')
  require.cache[wsPath] = { id: wsPath, filename: wsPath, loaded: true, exports: FakeSocket }
  const worker = { url: 'http://127.0.0.1:3100', status: 'ready', websocketPort: 3101 }
  let workers = [worker]
  const updates = []
  const managerPath = require.resolve('../dist/utils/workerManager')
  require.cache[managerPath] = {
    id: managerPath,
    filename: managerPath,
    loaded: true,
    exports: { getDiscoveredWorkers: () => workers, updateWorkerStatus: (...args) => updates.push(args) },
  }
  const manager = require('../dist/websocket/workerWebsockets')
  t.after(() => {
    workers = []
    manager.cleanupObsoleteWebsockets()
    for (const socket of instances) socket.emit('close')
  })
  manager.connectAllWorkersWebsockets()
  const old = instances[0]
  old.emit('open')
  workers = []
  manager.cleanupObsoleteWebsockets()
  workers = [worker]
  manager.connectAllWorkersWebsockets()
  const replacement = instances[1]
  old.emit('message', JSON.stringify({ status: 'offline' }))
  old.emit('close')
  assert.equal(updates.length, 0)
  manager.connectAllWorkersWebsockets()
  assert.equal(instances.length, 2, 'A late close must not delete the replacement')
  replacement.emit('message', JSON.stringify({ slots: { used: 2, available: 0, limit: 1 } }))
  assert.equal(updates.length, 0, 'Invalid slot metadata must not be applied')
  replacement.emit('message', JSON.stringify({ status: 'ready' }))
  assert.equal(updates.length, 1)
})
