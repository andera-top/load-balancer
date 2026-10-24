const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function loadConfig(overrides = {}) {
  return spawnSync(process.execPath, ['-e', "require('./dist/config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, LB_AUTH_KEY: 'test-key', ...overrides },
    encoding: 'utf8',
  })
}

test('invalid numeric LB configuration fails fast', () => {
  assert.equal(loadConfig({ WORKER_DISCOVERY_INTERVAL: 'invalid' }).status, 1)
  assert.equal(loadConfig({ WORKER_DISCOVERY_RETRIES: '-1' }).status, 1)
  assert.equal(loadConfig({ TASK_ATTEMPTS: '0' }).status, 1)
  assert.equal(loadConfig({ LOG_LEVEL: 'verbose' }).status, 1)
  assert.equal(loadConfig({ LB_AUTH_KEY: ' test-key' }).status, 1)
  // Node fires larger timer delays after 1 ms.
  assert.equal(loadConfig({ TASK_TIMEOUT: '3000000000' }).status, 1)
  assert.equal(loadConfig({ REQUEST_BODY_LIMIT: '10 megs' }).status, 1)
  assert.equal(loadConfig({ REQUEST_BODY_LIMIT: '512kb' }).status, 0)
  assert.equal(loadConfig().status, 0)
})
