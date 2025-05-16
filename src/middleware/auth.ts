import { Request, Response, NextFunction } from 'express'
import { config } from '../config'

export function requireAuth(options?: { header?: string }) {
  if (typeof options === 'function') {
    throw new Error('requireAuth must be called as a function: requireAuth()')
  }
  const header = options?.header || 'authorization'
  return (req: Request, res: Response, next: NextFunction) => {
    let rawAuth = req.headers[header] || req.headers['x-lb-auth']
    let authKey = typeof rawAuth === 'string' ? rawAuth : undefined
    if (authKey && authKey.startsWith('Bearer ')) authKey = authKey.slice(7).trim()
    if (authKey === config.lbAuthKey) {
      return next()
    }
    return res.status(401).json({ error: 'Unauthorized (LB)' })
  }
}
