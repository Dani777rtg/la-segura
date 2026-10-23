import cookie from '@fastify/cookie'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import type { Config } from '../config.ts'
import { forbidden, unauthorized } from '../lib/errors.ts'

const COOKIE = 'ps_session'
const MAX_AGE_SEC = 7 * 24 * 3600

declare module 'fastify' {
  interface FastifyRequest {
    userId?: number
  }
}

// Sesión = JWT en cookie httpOnly (security-review de ECC: nunca en localStorage).
export async function sessionPlugin(app: FastifyInstance, config: Config) {
  await app.register(cookie)

  // Defensa CSRF junto a SameSite=Lax: un POST desde otro sitio trae un Origin distinto.
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
    const origin = req.headers.origin
    if (origin && origin !== config.WEB_ORIGIN) throw forbidden('bad_origin', 'Origen no permitido')
  })

  app.decorateRequest('userId', undefined)

  app.decorate('requireUser', async (req: FastifyRequest) => {
    const token = req.cookies[COOKIE]
    if (!token) throw unauthorized()
    try {
      const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string }
      req.userId = Number(payload.sub)
    } catch {
      throw unauthorized('Tu sesión venció, inicia sesión de nuevo')
    }
  })

  app.decorate('setSession', (reply: FastifyReply, userId: number) => {
    const token = jwt.sign({}, config.JWT_SECRET, { algorithm: 'HS256', subject: String(userId), expiresIn: MAX_AGE_SEC })
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: MAX_AGE_SEC,
    })
  })

  app.decorate('clearSession', (reply: FastifyReply) => {
    reply.clearCookie(COOKIE, { path: '/' })
  })
}

declare module 'fastify' {
  interface FastifyInstance {
    requireUser: (req: FastifyRequest) => Promise<void>
    setSession: (reply: FastifyReply, userId: number) => void
    clearSession: (reply: FastifyReply) => void
  }
}
