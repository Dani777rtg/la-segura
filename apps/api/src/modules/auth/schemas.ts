import { z } from 'zod'
import { normalizeColombianMobile } from '../../lib/phone.ts'

const phone = z
  .string()
  .max(20)
  .transform((v, ctx) => {
    const normalized = normalizeColombianMobile(v)
    if (!normalized) ctx.addIssue({ code: 'custom', message: 'Celular colombiano inválido' })
    return normalized ?? ''
  })

const password = z.string().min(8, 'Mínimo 8 caracteres').max(128)

export const registerBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone,
  password,
  municipalityCode: z.string().regex(/^\d{5}$/),
  localityId: z.number().int().min(1).max(20).optional(),
})

export const resendBody = z.object({ phone })
export const verifyBody = z.object({ phone, code: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos') })
export const resetBody = z.object({ phone, code: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos'), password })
export const loginBody = z.object({ phone, password: z.string().min(1).max(128) })

export type RegisterInput = z.infer<typeof registerBody>
