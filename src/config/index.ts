import dotenv from 'dotenv'

dotenv.config()

export const config = {
  port: Number(process.env.PORT || '4000'),
  bullmq: {
    redisHost: process.env.REDIS_HOST || 'localhost',
    redisPort: Number(process.env.REDIS_PORT || '6379'),
  },
  logLevel: process.env.LOG_LEVEL?.toLowerCase() || 'info',
  lbAuthKey: process.env.LB_AUTH_KEY || '',
  workerDiscoveryInterval: Number(process.env.WORKER_DISCOVERY_INTERVAL || '1000'),
  dashboardEnabled: process.env.DASHBOARD_ENABLED?.toLowerCase() === 'true',
  bullBoardEnabled: process.env.BULL_BOARD_ENABLED?.toLowerCase() === 'true',
  maxLogs: Number(process.env.MAX_LOGS || '1000'),
  wsHeartbeatInterval: Number(process.env.WS_HEARTBEAT_INTERVAL || '3000'),
  wsHeartbeatTimeout: Number(process.env.WS_HEARTBEAT_TIMEOUT || '3000'),
  workerDiscoveryTimeout: Number(process.env.WORKER_DISCOVERY_TIMEOUT || '3000'),
  workerDiscoveryRetries: Number(process.env.WORKER_DISCOVERY_RETRIES || '10'),
  taskTimeout: Number(process.env.TASK_TIMEOUT || '300000'),
  taskAttempts: Number(process.env.TASK_ATTEMPTS || '3'),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '10mb',
}

function assertConfig() {
  if (!['debug', 'info', 'warn', 'error'].includes(config.logLevel)) throw new Error('LOG_LEVEL must be debug, info, warn or error')
  if (!config.lbAuthKey || config.lbAuthKey !== config.lbAuthKey.trim()) throw new Error('Missing or invalid LB_AUTH_KEY in environment')
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('PORT must be an integer between 1 and 65535')
  if (!config.bullmq.redisHost) throw new Error('Missing REDIS_HOST in environment')
  if (!Number.isInteger(config.bullmq.redisPort) || config.bullmq.redisPort < 1 || config.bullmq.redisPort > 65535)
    throw new Error('REDIS_PORT must be an integer between 1 and 65535')
  for (const [name, value] of [
    ['WORKER_DISCOVERY_INTERVAL', config.workerDiscoveryInterval],
    ['WORKER_DISCOVERY_TIMEOUT', config.workerDiscoveryTimeout],
    ['WS_HEARTBEAT_INTERVAL', config.wsHeartbeatInterval],
    ['WS_HEARTBEAT_TIMEOUT', config.wsHeartbeatTimeout],
    ['MAX_LOGS', config.maxLogs],
    ['TASK_TIMEOUT', config.taskTimeout],
    ['TASK_ATTEMPTS', config.taskAttempts],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  }
  if (!Number.isInteger(config.workerDiscoveryRetries) || config.workerDiscoveryRetries < 0) {
    throw new Error('WORKER_DISCOVERY_RETRIES must be a non-negative integer')
  }
}
assertConfig()
