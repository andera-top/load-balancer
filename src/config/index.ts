import dotenv from 'dotenv'

dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  bullmq: {
    redisHost: process.env.REDIS_HOST || 'localhost',
    redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  logLevel: process.env.LOG_LEVEL?.toLowerCase() || 'info',
  lbAuthKey: process.env.LB_AUTH_KEY || '',
  workerDiscoveryInterval: parseInt(process.env.WORKER_DISCOVERY_INTERVAL || '1000', 10),
  dashboardEnabled: process.env.DASHBOARD_ENABLED?.toLowerCase() === 'true',
  bullBoardEnabled: process.env.BULL_BOARD_ENABLED?.toLowerCase() === 'true',
  maxLogs: parseInt(process.env.MAX_LOGS || '1000', 10),
  wsHeartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || '3000', 10),
  wsHeartbeatTimeout: parseInt(process.env.WS_HEARTBEAT_TIMEOUT || '3000', 10),
  workerDiscoveryTimeout: parseInt(process.env.WORKER_DISCOVERY_TIMEOUT || '3000', 10),
  workerDiscoveryRetries: parseInt(process.env.WORKER_DISCOVERY_RETRIES || '10', 10),
  taskTimeout: parseInt(process.env.TASK_TIMEOUT || '300000', 10),
  taskAttempts: parseInt(process.env.TASK_ATTEMPTS || '3', 10),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '10mb',
}

function assertConfig() {
  if (!config.lbAuthKey) throw new Error('Missing LB_AUTH_KEY in environment')
  if (!config.port) throw new Error('Missing PORT in environment')
  if (!config.bullmq.redisHost) throw new Error('Missing REDIS_HOST in environment')
  if (!config.bullmq.redisPort) throw new Error('Missing REDIS_PORT in environment')
}
assertConfig()
