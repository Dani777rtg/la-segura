import { z } from 'zod'

const bool = z.enum(['true', 'false']).transform((v) => v === 'true')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('postgres://parcero:parcero_dev_only@127.0.0.1:15432/parcero'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  // Origen permitido para peticiones que modifican datos (defensa CSRF junto a SameSite=Lax).
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  // Dirección pública del sitio: va dentro del QR del certificado.
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  // Segundos que se reutiliza el resultado del mapa (0 = sin caché).
  TERRITORY_CACHE_SEC: z.coerce.number().int().min(0).default(60),
  // Tope de cuentas reales (no demo): cada registro cuesta una plantilla de WhatsApp. 0 = sin tope.
  SIGNUP_CAP: z.coerce.number().int().min(0).default(0),
  // Llamadas por WhatsApp: servicio de voz (Python/Pipecat) al que se reenvían los avisos `calls` y clave compartida.
  VOICE_SERVICE_URL: z.string().optional(),
  VOICE_INTERNAL_KEY: z.string().min(24).optional(),
  // Mínimo de casos para publicar una celda del mapa (anonimato).
  MIN_CELL: z.coerce.number().int().min(1).default(3),
  // Saltos de proxy de confianza (0 = ninguno). Cloud Run detrás de su balanceador = 1. Nunca `true`: permite falsificar la IP.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  // fake: no envía nada. test_only: real solo al número de pruebas. live: real a cualquiera.
  WHATSAPP_SEND_MODE: z.enum(['fake', 'test_only', 'live']).default('fake'),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  // App Secret de Meta: firma (X-Hub-Signature-256) de los avisos entrantes. Verify token: apretón inicial del webhook.
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_TEST_NUMBER: z.string().optional(),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env)
  if (config.NODE_ENV === 'production' && config.WHATSAPP_SEND_MODE === 'fake') {
    throw new Error('WHATSAPP_SEND_MODE=fake no está permitido en producción')
  }
  if (config.NODE_ENV === 'production') {
    const missing = ['DATABASE_URL', 'WEB_ORIGIN', 'PUBLIC_BASE_URL'].filter((k) => !env[k])
    if (missing.length) throw new Error(`Faltan variables obligatorias en producción: ${missing.join(', ')}`)
  }
  return config
}
