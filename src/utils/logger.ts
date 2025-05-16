import { config } from '../config'
import chalk from 'chalk'

const MAX_LOGS = config.maxLogs
const logs: string[] = []

const levels = ['debug', 'info', 'warn', 'error']
const currentLevel = levels.indexOf(config.logLevel)

function shouldLog(level: string): boolean {
  return levels.indexOf(level) >= currentLevel
}

export function log(...args: any[]) {
  if (!shouldLog('info')) return
  writeLog('INFO', args)
}

export function warn(...args: any[]) {
  if (!shouldLog('warn')) return
  writeLog('WARN', args)
}

export function error(...args: any[]) {
  if (!shouldLog('error')) return
  writeLog('ERROR', args)
}

export function debug(...args: any[]) {
  if (!shouldLog('debug')) return
  writeLog('DEBUG', args)
}

function writeLog(level: string, args: any[]) {
  const timestamp = new Date().toISOString()
  const prefixColors: Record<string, (text: string) => string> = {
    '[LB]': chalk.hex('#FF00AF'),
    '[WORKER]': chalk.hex('#00BFAE'),
    '[TASK]': chalk.hex('#FF6600'),
    '[FUNCTION]': chalk.hex('#A259FF'),
    '[SERVICE]': chalk.hex('#00C853'),
    '[TAGS]': chalk.hex('#FFB300'),
    '[WEBHOOK]': chalk.hex('#FF1744'),
    '[WEBSOKET]': chalk.hex('#0091EA'),
  }

  let msg = args.map(stringify).join(' ')
  let coloredMsg = msg.replace(/(\[[A-Z]+\])/, match => {
    return prefixColors[match] ? prefixColors[match](match) : chalk.hex('#CCCCCC')(match)
  })
  const line = `[${timestamp}] [${level}] ${coloredMsg}`
  logs.push(line)
  if (logs.length > MAX_LOGS) logs.shift()

  let coloredLine = line
  if (level === 'INFO') coloredLine = chalk.blue(line)
  if (level === 'WARN') coloredLine = chalk.yellow(line)
  if (level === 'ERROR') coloredLine = chalk.red(line)
  if (level === 'DEBUG') coloredLine = chalk.gray(line)
  console.log(coloredLine)
}

export function getLogs(): string[] {
  return [...logs]
}

function stringify(value: any): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
