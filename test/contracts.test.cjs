const { test } = require('node:test')
const assert = require('node:assert/strict')
const { contractSignature } = require('../dist/utils/workerContracts')

test('MCP descriptions do not invalidate mixed-version Worker replicas', () => {
  const original = [{ name: 'hello', params: { name: { type: 'string', required: true } } }]
  const described = [{ name: 'hello', description: 'Greeting', params: { name: { description: 'Person', required: true, type: 'string' } } }]
  assert.equal(contractSignature(original), contractSignature(described))
  described[0].params.name.type = 'number'
  assert.notEqual(contractSignature(original), contractSignature(described))
})
