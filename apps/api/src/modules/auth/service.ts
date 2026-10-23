import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { Config } from '../../config.ts'
import type { Db } from '../../db/client.ts'
import type { WhatsappGateway } from '../../gateways/whatsapp.ts'
import { AppError, badRequest, conflict, forbidden, tooMany } from '../../lib/errors.ts'
import { maskPhone } from '../../lib/phone.ts'
import { subkey } from '../../lib/keys.ts'
import { hashPassword, verifyPassword } from '../../lib/password.ts'
import { hit } from '../../lib/rateLimit.ts'
import { grant } from '../credits/repo.ts'
import { BOGOTA_CODE, localityExists, municipalityExists } from '../locations/repo.ts'
import type { RegisterInput } from './schemas.ts'
import * as repo from './repo.ts'

export const WELCOME_CREDITS = 200
const OTP_TTL_SEC = 600
const OTP_MAX_ATTEMPTS = 5
// Regla del producto (ajustada para la exposición): máximo 4 códigos por IP cada 10 minutos (varias personas pueden
// registrarse desde la misma red o corregir un número mal escrito), 1 por minuto por celular y tope diario por celular.
const CODE_WINDOW_SEC = 600
const IP_CODES_PER_WINDOW = 4
const PHONE_WAIT_SEC = 60

export type AuthDeps = { db: Db; whatsapp: WhatsappGateway; config: Config }

export function createAuthService({ db, whatsapp, config }: AuthDeps) {
  const hashCode = (userId: number, code: string) =>
    createHmac('sha256', subkey(config.JWT_SECRET, 'otp')).update(`${userId}:${code}`).digest('hex')

  // Los límites se aplican ANTES de escribir nada: una petición rechazada no puede cambiar datos de nadie.
  async function limitCodeRequests(phone: string, ip: string) {
    await hit(db, `otp:ip:${ip}`, IP_CODES_PER_WINDOW, CODE_WINDOW_SEC, 'Desde esta conexión ya se pidieron varios códigos. Espera unos minutos')
    await hit(db, `otp:phone:${phone}`, 1, PHONE_WAIT_SEC, 'Espera un minuto antes de pedir otro código')
    await hit(db, `otp:phone-day:${phone}`, 5, 86_400, 'Superaste el máximo de códigos por hoy')
  }

  const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

  async function deliver(phone: string, code: string) {
    try {
      await whatsapp.sendAuthCode(phone, code)
    } catch (err) {
      console.error('Fallo al enviar el código por WhatsApp:', err instanceof Error ? err.message : 'desconocido')
      throw new AppError(502, 'whatsapp_unavailable', 'No pudimos enviar el código. Intenta de nuevo en unos minutos')
    }
    return { phone: maskPhone(phone), expiresInSec: OTP_TTL_SEC }
  }

  // Comprueba y consume el código de 6 dígitos (mismo control de intentos para registro y recuperación).
  async function checkOtp(tx: Parameters<typeof repo.findActiveOtp>[0], userId: number, code: string) {
    const otp = await repo.findActiveOtp(tx, userId)
    if (!otp) return 'invalid' as const
    if (otp.attempts >= OTP_MAX_ATTEMPTS) return 'locked' as const
    const given = Buffer.from(hashCode(userId, code))
    const expected = Buffer.from(otp.codeHash)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      await repo.bumpOtpAttempts(tx, otp.id)
      return 'invalid' as const
    }
    await repo.consumeOtp(tx, otp.id)
    return 'ok' as const
  }

  return {
    async register(input: RegisterInput, ip: string) {
      if (!(await municipalityExists(db, input.municipalityCode))) throw badRequest('invalid_municipality', 'Municipio no válido')
      const isBogota = input.municipalityCode === BOGOTA_CODE
      if (isBogota && !input.localityId) throw badRequest('locality_required', 'Elige tu localidad de Bogotá')
      if (isBogota && !(await localityExists(db, input.localityId!))) throw badRequest('invalid_locality', 'Localidad no válida')

      // Tope de registros (control de costo): un celular que ya existe puede reintentar; uno nuevo no entra si el cupo está lleno.
      if (config.SIGNUP_CAP > 0 && !(await repo.findUserByPhone(db, input.phone))) {
        if ((await repo.countRealUsers(db)) >= config.SIGNUP_CAP) {
          throw new AppError(403, 'signup_cap_reached', 'El cupo de registros de esta demostración está lleno por ahora.')
        }
      }
      await limitCodeRequests(input.phone, ip)
      const passwordHash = await hashPassword(input.password)
      const code = newCode()
      // Datos nuevos y código nuevo van juntos: reescribir una cuenta sin verificar siempre invalida el código anterior.
      const user = await db.transaction(async (tx) => {
        const u = await repo.upsertUnverifiedUser(tx, {
          phone: input.phone,
          name: input.name,
          passwordHash,
          municipalityCode: input.municipalityCode,
          localityId: isBogota ? input.localityId! : null,
        })
        if (!u) return undefined
        await repo.invalidateOtps(tx, u.id)
        await repo.createOtp(tx, u.id, hashCode(u.id, code), OTP_TTL_SEC)
        return u
      })
      if (!user) throw conflict('phone_taken', 'Ese celular ya tiene una cuenta. Inicia sesión')
      return deliver(user.phone, code)
    },

    async resendCode(phone: string, ip: string) {
      const user = await repo.findUserByPhone(db, phone)
      // Misma respuesta exista o no la cuenta: no revela qué celulares están registrados.
      if (!user || user.phoneVerifiedAt) return { phone: maskPhone(phone), expiresInSec: OTP_TTL_SEC }
      await limitCodeRequests(phone, ip)
      const code = newCode()
      await db.transaction(async (tx) => {
        await repo.invalidateOtps(tx, user.id)
        await repo.createOtp(tx, user.id, hashCode(user.id, code), OTP_TTL_SEC)
      })
      return deliver(user.phone, code)
    },

    async verify(phone: string, code: string) {
      const invalid = badRequest('invalid_code', 'Código incorrecto o vencido')
      const user = await repo.findUserByPhone(db, phone)
      if (!user) throw invalid

      const outcome = await db.transaction(async (tx) => {
        const r = await checkOtp(tx, user.id, code)
        if (r === 'ok' && !user.phoneVerifiedAt) {
          await repo.markPhoneVerified(tx, user.id)
          await grant(tx, user.id, WELCOME_CREDITS, 'welcome', `welcome:${user.id}`)
        }
        return r
      })
      if (outcome === 'locked') throw tooMany('Demasiados intentos. Pide un código nuevo', CODE_WINDOW_SEC)
      if (outcome !== 'ok') throw invalid
      return (await repo.findUserById(db, user.id))!
    },

    // Recuperar contraseña: código por WhatsApp al celular de la cuenta. Misma respuesta exista o no la cuenta.
    async forgotPassword(phone: string, ip: string) {
      const user = await repo.findUserByPhone(db, phone)
      if (!user || !user.phoneVerifiedAt) return { phone: maskPhone(phone), expiresInSec: OTP_TTL_SEC }
      await limitCodeRequests(phone, ip)
      const code = newCode()
      await db.transaction(async (tx) => {
        await repo.invalidateOtps(tx, user.id)
        await repo.createOtp(tx, user.id, hashCode(user.id, code), OTP_TTL_SEC)
      })
      return deliver(user.phone, code)
    },

    async resetPassword(phone: string, code: string, newPassword: string) {
      const user = await repo.findUserByPhone(db, phone)
      if (!user || !user.phoneVerifiedAt) throw badRequest('invalid_code', 'Código incorrecto o vencido')
      const passwordHash = await hashPassword(newPassword)
      const outcome = await db.transaction(async (tx) => {
        const r = await checkOtp(tx, user.id, code)
        if (r === 'ok') await repo.setPassword(tx, user.id, passwordHash)
        return r
      })
      if (outcome === 'locked') throw tooMany('Demasiados intentos. Pide un código nuevo', CODE_WINDOW_SEC)
      if (outcome !== 'ok') throw badRequest('invalid_code', 'Código incorrecto o vencido')
      return (await repo.findUserById(db, user.id))!
    },

    async login(phone: string, password: string, ip: string) {
      await hit(db, `login:${ip}:${phone}`, 10, 600, 'Demasiados intentos. Espera unos minutos')
      // Tope por celular sin importar la IP: frena la fuerza bruta distribuida.
      await hit(db, `login-phone:${phone}`, 30, 3600, 'Demasiados intentos. Espera un rato')
      const user = await repo.findUserByPhone(db, phone)
      // Se verifica siempre una contraseña (aunque no exista el usuario) para igualar tiempos.
      const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')
      if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'Celular o contraseña incorrectos')
      if (!user.phoneVerifiedAt) throw forbidden('phone_not_verified', 'Verifica tu celular con el código de WhatsApp')
      return user
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>
