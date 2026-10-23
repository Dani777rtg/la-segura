import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity()
const userRef = () =>
  bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

// ---------- Ubicaciones (DIVIPOLA / localidades de Bogotá) ----------

export const municipalities = pgTable(
  'municipalities',
  {
    code: text('code').primaryKey(),
    deptCode: text('dept_code').notNull(),
    dept: text('dept').notNull(),
    name: text('name').notNull(),
    nameNorm: text('name_norm').notNull(),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
  },
  (t) => [index('municipalities_name_norm_idx').on(t.nameNorm.op('text_pattern_ops'))],
)

export const localities = pgTable('localities', {
  id: smallint('id').primaryKey(),
  name: text('name').notNull().unique(),
  geojson: jsonb('geojson'),
})

// ---------- Usuarios y verificación ----------

export const users = pgTable('users', {
  id: id(),
  phone: text('phone').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  municipalityCode: text('municipality_code')
    .notNull()
    .references(() => municipalities.code),
  localityId: smallint('locality_id').references(() => localities.id),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  // Usuarios sintéticos de demostración: siempre se rotulan como tales en la interfaz.
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: createdAt(),
})

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: id(),
    userId: userRef(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_user_idx').on(t.userId)],
)

// Contadores de ventana fija compartidos entre instancias (límite de códigos por IP y celular).
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull(),
})

// ---------- Casos analizados e indicadores (reputación comunitaria) ----------

export type CaseSource = { name: string; result: 'ok' | 'flag' | 'simulated' | 'unavailable' | 'unverified'; detail: string }

export const cases = pgTable(
  'cases',
  {
    id: id(),
    userId: userRef(),
    channel: text('channel').notNull().default('web'),
    inputText: text('input_text').notNull(),
    risk: text('risk').notNull(),
    // Número interno del modelo: no se muestra a nadie (no está calibrado). Lo que se muestra es `level`.
    confidence: smallint('confidence').notNull(),
    level: text('level'),
    fraudType: text('fraud_type').notNull(),
    summary: text('summary').notNull(),
    reasons: jsonb('reasons').$type<string[]>().notNull(),
    advice: jsonb('advice').$type<string[]>().notNull(),
    sources: jsonb('sources').$type<CaseSource[]>().notNull(),
    // Ubicación de la persona al momento del caso: base del mapa territorial (agregado y anónimo).
    municipalityCode: text('municipality_code')
      .notNull()
      .references(() => municipalities.code),
    localityId: smallint('locality_id').references(() => localities.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('cases_user_idx').on(t.userId, t.createdAt),
    index('cases_municipality_idx').on(t.municipalityCode, t.createdAt),
    check('cases_risk_valid', sql`${t.risk} IN ('alto', 'medio', 'bajo')`),
    check('cases_confidence_valid', sql`${t.confidence} BETWEEN 0 AND 100`),
  ],
)

// Teléfonos y dominios vistos en casos riesgosos. Se guardan con HMAC: se pueden buscar, no leer.
export const indicators = pgTable(
  'indicators',
  {
    id: id(),
    kind: text('kind').notNull(),
    valueHash: text('value_hash').notNull(),
    display: text('display').notNull(),
    caseId: bigint('case_id', { mode: 'number' })
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    userId: userRef(),
    createdAt: createdAt(),
  },
  (t) => [
    // Un mismo usuario cuenta una sola vez por indicador (evita inflar la reputación).
    uniqueIndex('indicators_user_value_uq').on(t.kind, t.valueHash, t.userId),
    index('indicators_lookup_idx').on(t.kind, t.valueHash),
    check('indicators_kind_valid', sql`${t.kind} IN ('phone', 'domain')`),
  ],
)

// ---------- Feed social ----------

export const POST_KINDS = ['estafaron', 'intentaron'] as const

export const posts = pgTable(
  'posts',
  {
    id: id(),
    userId: userRef(),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    fraudType: text('fraud_type').notNull().default('otro'),
    municipalityCode: text('municipality_code')
      .notNull()
      .references(() => municipalities.code),
    localityId: smallint('locality_id').references(() => localities.id),
    status: text('status').notNull().default('published'),
    // Alertas publicadas desde un análisis: un caso se publica una sola vez, y por defecto sin mostrar el nombre.
    caseId: bigint('case_id', { mode: 'number' }).unique().references(() => cases.id, { onDelete: 'set null' }),
    anonymous: boolean('anonymous').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('posts_feed_idx').on(t.status, t.id),
    check('posts_kind_valid', sql`${t.kind} IN ('estafaron', 'intentaron')`),
    check('posts_status_valid', sql`${t.status} IN ('published', 'hidden')`),
  ],
)

export const postConfirmations = pgTable(
  'post_confirmations',
  {
    postId: bigint('post_id', { mode: 'number' })
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: userRef(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
)

// ---------- Compras de créditos (Mercado Pago) ----------

export const purchases = pgTable(
  'purchases',
  {
    id: id(),
    userId: userRef(),
    credits: integer('credits').notNull(),
    // Importes en pesos colombianos enteros; amountCop = baseCop + ivaCop es lo que se cobra.
    baseCop: integer('base_cop').notNull(),
    ivaCop: integer('iva_cop').notNull(),
    amountCop: integer('amount_cop').notNull(),
    status: text('status').notNull().default('pending'),
    mpPreferenceId: text('mp_preference_id'),
    mpPaymentId: text('mp_payment_id'),
    createdAt: createdAt(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('purchases_payment_uq').on(t.mpPaymentId),
    index('purchases_user_idx').on(t.userId, t.createdAt),
    check('purchases_status_valid', sql`${t.status} IN ('pending', 'approved', 'rejected')`),
    check('purchases_amount_consistent', sql`${t.amountCop} = ${t.baseCop} + ${t.ivaCop}`),
  ],
)

// ---------- Bot de WhatsApp ----------

// Mensajes de WhatsApp ya procesados: Meta reintenta los avisos y no se debe responder dos veces.
export const waMessages = pgTable('wa_messages', {
  id: text('id').primaryKey(),
  // Solo se da por atendido cuando termina bien: un reintento de Meta tras un corte sí se reprocesa.
  done: boolean('done').notNull().default(false),
  createdAt: createdAt(),
})

// Estado mínimo de la conversación: último caso analizado y si se espera un "sí" para armar el reporte.
export const botState = pgTable('bot_state', {
  phone: text('phone').primaryKey(),
  lastCaseId: bigint('last_case_id', { mode: 'number' }).references(() => cases.id, { onDelete: 'set null' }),
  awaitingReport: boolean('awaiting_report').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------- Memoria de la conversación (una sola por persona: WhatsApp, llamadas y app) ----------

// Cada turno de la conversación, venga del canal que venga. Es la memoria de corto plazo del asistente.
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: id(),
    userId: userRef(),
    channel: text('channel').notNull(), // whatsapp | voice | app
    role: text('role').notNull(), // user | assistant
    content: text('content').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('chat_messages_user_idx').on(t.userId, t.id),
    check('chat_messages_role_valid', sql`${t.role} IN ('user', 'assistant')`),
  ],
)

// Memoria de largo plazo: resumen acumulado de lo que ya salió de la ventana reciente.
export const chatMemory = pgTable('chat_memory', {
  userId: bigint('user_id', { mode: 'number' }).primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull().default(''),
  summarizedUntil: bigint('summarized_until', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------- Presentación (diapositivas controladas desde el celular) ----------

export const presentations = pgTable('presentations', {
  code: text('code').primaryKey(),
  tokenHash: text('token_hash').notNull(), // solo quien tiene el enlace de control puede cambiar la diapositiva
  slide: integer('slide').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------- Reportes y registro inmutable ----------

export const REPORT_TYPES = ['suplantacion_entidad', 'robo_cuenta', 'compra_prestamo_falso', 'generico'] as const

export const reports = pgTable(
  'reports',
  {
    id: id(),
    // Código público corto: aparece en el PDF y en el QR de verificación.
    code: text('code').notNull().unique(),
    caseId: bigint('case_id', { mode: 'number' })
      .notNull()
      .unique()
      .references(() => cases.id),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    // Texto exacto que se firmó: se guarda como texto (no jsonb) para que el hash siempre se pueda recalcular.
    payload: text('payload').notNull(),
    payloadHash: text('payload_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('reports_user_idx').on(t.userId, t.createdAt),
    check('reports_type_valid', sql`${t.type} IN ('suplantacion_entidad', 'robo_cuenta', 'compra_prestamo_falso', 'generico')`),
  ],
)

// Cadena de hashes de solo anexar: cada entrada incluye el hash de la anterior.
// Un trigger en Postgres impide UPDATE y DELETE (migración 0003).
export const ledgerEntries = pgTable('ledger_entries', {
  idx: integer('idx').primaryKey(),
  reportId: bigint('report_id', { mode: 'number' })
    .notNull()
    .unique()
    .references(() => reports.id),
  payloadHash: text('payload_hash').notNull(),
  prevHash: text('prev_hash').notNull(),
  entryHash: text('entry_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date', precision: 3 }).notNull(),
})

// ---------- Créditos (libro inmutable + saldo) ----------

export const creditAccounts = pgTable(
  'credit_accounts',
  {
    userId: bigint('user_id', { mode: 'number' })
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    balance: integer('balance').notNull().default(0),
  },
  (t) => [check('credit_accounts_balance_non_negative', sql`${t.balance} >= 0`)],
)

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: id(),
    userId: userRef(),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    // Clave de idempotencia: un mismo pago o bono no se aplica dos veces.
    ref: text('ref'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('credit_ledger_ref_uq').on(t.ref),
    index('credit_ledger_user_idx').on(t.userId, t.createdAt),
    check('credit_ledger_delta_non_zero', sql`${t.delta} <> 0`),
  ],
)
