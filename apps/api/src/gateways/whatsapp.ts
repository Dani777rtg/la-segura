import type { Config } from '../config.ts'

// Puerto: lo único que el resto de la app sabe de WhatsApp. Permite simularlo en pruebas y en carga.
export interface WhatsappGateway {
  sendAuthCode(phone: string, code: string): Promise<void>
  sendText(to: string, body: string): Promise<void>
  sendAudio(to: string, audio: Buffer, mime: string): Promise<void>
  sendDocument(to: string, doc: Buffer, filename: string, caption?: string): Promise<void>
  downloadMedia(mediaId: string): Promise<{ data: Buffer; mime: string }>
}

export type Outgoing =
  | { kind: 'code'; to: string; code: string }
  | { kind: 'text'; to: string; body: string }
  | { kind: 'audio'; to: string; mime: string; bytes: number }
  | { kind: 'document'; to: string; filename: string; bytes: number; caption?: string }

export class FakeWhatsapp implements WhatsappGateway {
  /** En desarrollo local imprime los códigos de verificación (nunca se activa en producción). */
  constructor(private readonly verbose = false) {}

  /** Todo lo que "se envió", para las pruebas. */
  readonly outbox: Outgoing[] = []
  /** Medios que el bot puede "descargar" en pruebas. */
  readonly media = new Map<string, { data: Buffer; mime: string }>()

  /** Atajo histórico: solo los códigos de verificación enviados. */
  get sent() {
    return this.outbox.filter((o) => o.kind === 'code').map((o) => ({ phone: o.to, code: (o as { code: string }).code }))
  }
  /** Pruebas: hace fallar los próximos N envíos de texto (simula un corte). */
  failNextTexts = 0
  reset() {
    this.outbox.length = 0
    this.failNextTexts = 0
  }
  async sendAuthCode(phone: string, code: string) {
    this.outbox.push({ kind: 'code', to: phone, code })
    if (this.verbose) console.log(`[WhatsApp simulado] código para ${phone}: ${code}`)
  }
  async sendText(to: string, body: string) {
    if (this.failNextTexts > 0) {
      this.failNextTexts--
      throw new Error('envío simulado fallido')
    }
    this.outbox.push({ kind: 'text', to, body })
  }
  async sendAudio(to: string, audio: Buffer, mime: string) {
    this.outbox.push({ kind: 'audio', to, mime, bytes: audio.length })
  }
  async sendDocument(to: string, doc: Buffer, filename: string, caption?: string) {
    this.outbox.push({ kind: 'document', to, filename, bytes: doc.length, caption })
  }
  async downloadMedia(mediaId: string) {
    const m = this.media.get(mediaId)
    if (!m) throw new Error('medio no encontrado')
    return m
  }
}

const AUTH_TEMPLATE = 'parcero_codigo_verificacion'

// Solo se envía el token a hosts de Meta: se compara el nombre de host completo, no un trozo de la URL.
export function isMetaMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && ['.fbcdn.net', '.fbsbx.com', '.whatsapp.net'].some((d) => u.hostname.endsWith(d))
  } catch {
    return false
  }
}

class CloudApiWhatsapp implements WhatsappGateway {
  constructor(
    private readonly cfg: Config,
    private readonly fallback: FakeWhatsapp,
  ) {}

  /** test_only: solo se envía de verdad al número de pruebas autorizado. El resto se queda en el registro simulado. */
  private simulated(to: string) {
    return this.cfg.WHATSAPP_SEND_MODE === 'test_only' && to !== this.cfg.WHATSAPP_TEST_NUMBER
  }

  private get base() {
    const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: numberId, WHATSAPP_API_VERSION: version } = this.cfg
    if (!token || !numberId) throw new Error('Faltan credenciales de WhatsApp')
    return { token, root: `https://graph.facebook.com/${version}`, numberId }
  }

  private async send(body: object) {
    const { token, root, numberId } = this.base
    const res = await fetch(`${root}/${numberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
      signal: AbortSignal.timeout(15_000),
    })
    // No se registra el cuerpo: puede incluir datos del destinatario.
    if (!res.ok) throw new Error(`WhatsApp respondió ${res.status}`)
  }

  private async upload(data: Buffer, mime: string, filename: string) {
    const { token, root, numberId } = this.base
    const form = new FormData()
    form.set('messaging_product', 'whatsapp')
    form.set('type', mime)
    form.set('file', new Blob([new Uint8Array(data)], { type: mime }), filename)
    const res = await fetch(`${root}/${numberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`WhatsApp respondió ${res.status} al subir el archivo`)
    return ((await res.json()) as { id: string }).id
  }

  async sendAuthCode(phone: string, code: string) {
    if (this.simulated(phone)) return this.fallback.sendAuthCode(phone, code)
    await this.send({
      to: phone,
      type: 'template',
      template: {
        name: AUTH_TEMPLATE,
        language: { code: 'es' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    })
  }

  async sendText(to: string, body: string) {
    if (this.simulated(to)) return this.fallback.sendText(to, body)
    await this.send({ to, type: 'text', text: { body, preview_url: false } })
  }

  async sendAudio(to: string, audio: Buffer, mime: string) {
    if (this.simulated(to)) return this.fallback.sendAudio(to, audio, mime)
    await this.send({ to, type: 'audio', audio: { id: await this.upload(audio, mime, 'voz.ogg') } })
  }

  async sendDocument(to: string, doc: Buffer, filename: string, caption?: string) {
    if (this.simulated(to)) return this.fallback.sendDocument(to, doc, filename, caption)
    await this.send({ to, type: 'document', document: { id: await this.upload(doc, 'application/pdf', filename), filename, caption } })
  }

  async downloadMedia(mediaId: string) {
    const { token, root } = this.base
    const meta = await fetch(`${root}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
    if (!meta.ok) throw new Error(`WhatsApp respondió ${meta.status} al pedir el medio`)
    const { url, mime_type: mime } = (await meta.json()) as { url: string; mime_type: string }
    // La dirección de descarga solo se acepta si es de Meta (evita que un aviso falso nos haga pedir otro sitio).
    if (!isMetaMediaUrl(url)) throw new Error('Dirección de medio no permitida')
    const file = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
    if (!file.ok) throw new Error(`WhatsApp respondió ${file.status} al descargar el medio`)
    const data = Buffer.from(await file.arrayBuffer())
    if (data.length > 6 * 1024 * 1024) throw new Error('Medio demasiado grande')
    return { data, mime }
  }
}

export function createWhatsapp(cfg: Config, fake: FakeWhatsapp = new FakeWhatsapp(cfg.NODE_ENV === 'development')): WhatsappGateway {
  return cfg.WHATSAPP_SEND_MODE === 'fake' ? fake : new CloudApiWhatsapp(cfg, fake)
}
