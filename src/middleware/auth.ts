import { Request, Response, NextFunction } from 'express'
import { createHash, timingSafeEqual } from 'crypto'
import { config } from '../config'

/** Constant-time key comparison; hashing equalizes lengths. */
export function safeEqual(value: string | undefined, key: string): boolean {
  if (value === undefined || !key) return false
  const hash = (input: string) => createHash('sha256').update(input).digest()
  return timingSafeEqual(hash(value), hash(key))
}

export function requireAuth(options?: { header?: string }) {
  if (typeof options === 'function') {
    throw new Error('requireAuth must be called as a function: requireAuth()')
  }
  const header = options?.header || 'authorization'
  return (req: Request, res: Response, next: NextFunction) => {
    let rawAuth = req.headers[header] || req.headers['x-lb-auth']
    let authKey = typeof rawAuth === 'string' ? rawAuth : undefined
    if (authKey && authKey.startsWith('Bearer ')) authKey = authKey.slice(7).trim()
    if (safeEqual(authKey, config.lbAuthKey)) {
      return next()
    }
    return res.status(401).json({ error: 'Unauthorized' })
  }
}
