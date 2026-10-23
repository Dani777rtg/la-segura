import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { LEVEL_LABEL, levelFromRisk, type Level } from '../agent/level.ts'
import { STEPS, TYPE_LABEL } from './guidance.ts'
import type { Verification } from './ledger.ts'
import type { ReportPayload } from './payload.ts'

// Documento sobrio, solo blanco y negro, tipografía de documento formal (Times).
const BODY = 'Times-Roman'
const BOLD = 'Times-Bold'
const ITALIC = 'Times-Italic'
const MONO = 'Courier'

const RISK_LABEL: Record<string, string> = { alto: 'ALTO', medio: 'MEDIO', bajo: 'BAJO' }

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' })
const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00-05:00`).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long' })

export async function renderReportPdf(p: ReportPayload, v: Verification, verifyUrl: string): Promise<Buffer> {
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 220, color: { dark: '#000000', light: '#ffffff' } })
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 64, right: 64 }, bufferPages: true,
    info: { Title: `Reporte ${p.code}`, Author: 'La Segura', Subject: 'Reporte de posible fraude digital' } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const left = doc.page.margins.left
  const rule = (thick = 0.6) => {
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(thick).strokeColor('#000').stroke()
    doc.moveDown(0.6)
  }
  const heading = (n: number, text: string) => {
    doc.moveDown(0.8).font(BOLD).fontSize(11.5).fillColor('#000').text(`${n}. ${text.toUpperCase()}`)
    rule(0.4)
  }
  const field = (label: string, value: string) =>
    doc.font(BOLD).fontSize(10.5).text(`${label}: `, { continued: true }).font(BODY).text(value)

  // Encabezado
  doc.font(BOLD).fontSize(10).text('LA SEGURA', left, doc.y, { continued: true, width })
  doc.font(BODY).text(`Reporte N.º ${p.code}`, { align: 'right' })
  rule(1.2)
  doc.moveDown(0.3).font(BOLD).fontSize(17).text('REPORTE DE POSIBLE FRAUDE DIGITAL', { align: 'center' })
  doc.moveDown(0.2).font(ITALIC).fontSize(10.5).text(TYPE_LABEL[p.type], { align: 'center' })
  doc.moveDown(0.8)

  const boxY = doc.y
  doc.font(ITALIC).fontSize(9.5).text(
    'Este documento es un soporte organizado por la persona afectada y verificable. No es una denuncia formal ni reemplaza la denuncia ante las autoridades: debe presentarse ante ellas como anexo.',
    left + 8, boxY + 6, { width: width - 16, align: 'justify' })
  const boxH = doc.y - boxY + 6
  doc.rect(left, boxY, width, boxH).lineWidth(0.6).strokeColor('#000').stroke()
  doc.y = boxY + boxH

  heading(1, 'Datos de quien reporta')
  field('Nombre', p.reporter.name)
  field('Ubicación', [
    p.location.locality && `Localidad ${p.location.locality}`,
    p.location.municipality,
    p.location.department !== p.location.municipality ? p.location.department : '',
  ].filter(Boolean).join(', '))
  field('Fecha de generación', fmtDate(p.createdAt))

  heading(2, 'Relato de los hechos')
  doc.font(BODY).fontSize(11).text(p.narrative, { align: 'justify', lineGap: 2 })

  heading(3, 'Datos del hecho')
  if (p.occurredAt) field('Fecha aproximada', fmtDay(p.occurredAt))
  if (p.channel) field('Canal', p.channel)
  field('Dinero perdido', p.amountCop ? `$${p.amountCop.toLocaleString('es-CO')} COP` : 'No reporta pérdida de dinero')
  if (p.details) field('Detalles adicionales', p.details)
  if (p.evidence.domains.length) field('Sitios o enlaces', p.evidence.domains.join(', '))
  if (p.evidence.phones.length) field('Números de celular', p.evidence.phones.map((n) => `+${n}`).join(', '))

  heading(4, 'Valoración automática (orientativa)')
  doc.font(BODY).fontSize(10.5).text(
    `Nivel de alerta: ${LEVEL_LABEL[(p.analysis.level ?? levelFromRisk(p.analysis.risk)) as Level] ?? RISK_LABEL[p.analysis.risk] ?? p.analysis.risk}. ${p.analysis.summary} Es una orientación automatizada y no una determinación judicial.`,
    { align: 'justify' })

  heading(5, 'Mensaje o contenido recibido (transcripción)')
  doc.font(MONO).fontSize(9).text(p.receivedText.slice(0, 1500) + (p.receivedText.length > 1500 ? ' […]' : ''), { lineGap: 1 })

  heading(6, 'Qué hacer ahora')
  STEPS[p.type].forEach((step, i) => doc.font(BODY).fontSize(10.5).text(`${i + 1}. ${step}`, { align: 'justify', lineGap: 1.5 }).moveDown(0.25))
  doc.font(ITALIC).fontSize(9).text('Confirma los canales y números en los sitios oficiales de cada entidad: pueden cambiar.')

  // Certificado
  if (doc.y > doc.page.height - 250) doc.addPage()
  heading(7, 'Certificado de registro verificable')
  const certY = doc.y
  doc.image(qr, left + width - 110, certY, { width: 110 })
  const textWidth = width - 125
  doc.font(BODY).fontSize(9.5)
  doc.text('Este reporte quedó registrado en una cadena de hashes de solo anexar. Si el contenido o el orden de la cadena se alteran, la verificación falla.', left, certY, { width: textWidth, align: 'justify' })
  doc.moveDown(0.4)
  for (const [label, value] of [
    ['Código', p.code],
    ['Registro N.º', String(v.idx)],
    ['Registrado (UTC)', v.recordedAt],
    ['Huella del contenido (SHA-256)', v.payloadHash],
    ['Huella del registro (SHA-256)', v.entryHash],
  ] as const) {
    doc.font(BOLD).fontSize(8.5).text(`${label}:`, left, doc.y, { width: textWidth })
    doc.font(MONO).fontSize(7.5).text(value, { width: textWidth })
  }
  doc.font(BODY).fontSize(9.5).text(`Verifica este documento escaneando el código QR o en: ${verifyUrl}`, left, Math.max(doc.y + 6, certY + 118), { width })

  // Numeración de páginas
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    // Sin margen inferior, el pie de página no dispara una página nueva (comportamiento de pdfkit).
    doc.page.margins.bottom = 0
    doc.font(BODY).fontSize(8.5).fillColor('#000').text(`${p.code} · Página ${i + 1} de ${range.count}`, left, doc.page.height - 44, { width, align: 'center', lineBreak: false })
  }
  doc.end()
  return done
}
