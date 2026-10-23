import { createHmac } from 'node:crypto'

// Una sola clave maestra (JWT_SECRET) y subclaves por propósito: la filtración o rotación de una
// no arrastra a las demás (OTP, huellas de reputación).
export const subkey = (master: string, purpose: string) => createHmac('sha256', master).update(`parcero:${purpose}`).digest('hex')
