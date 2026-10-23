import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db/client.ts'
import { unauthorized } from '../../lib/errors.ts'
import { getBalance } from '../credits/repo.ts'
import { loginBody, registerBody, resendBody, resetBody, verifyBody } from './schemas.ts'
import { findUserById, type User } from './repo.ts'
import type { AuthService } from './service.ts'

const publicUser = (u: User, credits: number) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  municipalityCode: u.municipalityCode,
  localityId: u.localityId,
  credits,
})

export function authRoutes(app: FastifyInstance, db: Db, auth: AuthService) {
  app.post('/auth/register', async (req, reply) => {
    const result = await auth.register(registerBody.parse(req.body), req.ip)
    return reply.code(202).send(result)
  })

  app.post('/auth/resend-code', async (req) => auth.resendCode(resendBody.parse(req.body).phone, req.ip))

  app.post('/auth/verify', async (req, reply) => {
    const { phone, code } = verifyBody.parse(req.body)
    const user = await auth.verify(phone, code)
    app.setSession(reply, user.id)
    return publicUser(user, await getBalance(db, user.id))
  })

  app.post('/auth/forgot-password', async (req) => auth.forgotPassword(resendBody.parse(req.body).phone, req.ip))

  app.post('/auth/reset-password', async (req, reply) => {
    const { phone, code, password } = resetBody.parse(req.body)
    const user = await auth.resetPassword(phone, code, password)
    app.setSession(reply, user.id)
    return publicUser(user, await getBalance(db, user.id))
  })

  app.post('/auth/login', async (req, reply) => {
    const { phone, password } = loginBody.parse(req.body)
    const user = await auth.login(phone, password, req.ip)
    app.setSession(reply, user.id)
    return publicUser(user, await getBalance(db, user.id))
  })

  app.post('/auth/logout', async (_req, reply) => {
    app.clearSession(reply)
    return reply.code(204).send()
  })

  app.get('/auth/me', { preHandler: app.requireUser }, async (req) => {
    const user = await findUserById(db, req.userId!)
    if (!user) throw unauthorized()
    return publicUser(user, await getBalance(db, user.id))
  })
}
