import type { REPORT_TYPES } from '../../db/schema.ts'

export type ReportType = (typeof REPORT_TYPES)[number]

export const TYPE_LABEL: Record<ReportType, string> = {
  suplantacion_entidad: 'Suplantación de banco o entidad (phishing, vishing o smishing)',
  robo_cuenta: 'Robo o suplantación de cuenta de WhatsApp o redes sociales',
  compra_prestamo_falso: 'Compra, tienda, pago o préstamo falso',
  generico: 'Posible fraude digital',
}

// Mapea lo que detecta el agente al tipo de reporte (4 plantillas).
export function reportTypeForFraud(fraudType: string): ReportType {
  switch (fraudType) {
    case 'suplantacion_entidad':
    case 'citacion_falsa':
      return 'suplantacion_entidad'
    case 'robo_whatsapp':
    case 'sim_swapping':
      return 'robo_cuenta'
    case 'tienda_falsa':
    case 'prestamo_falso':
    case 'pago_falso':
    case 'inversion_falsa':
      return 'compra_prestamo_falso'
    default:
      return 'generico'
  }
}

const COMMON_LAST = [
  'Presenta la denuncia en ADenunciar (Policía Nacional y Fiscalía), en adenunciar.policia.gov.co, o en una Unidad de Reacción Inmediata. Adjunta este documento.',
  'Orientación y verificación de sitios en el CAI Virtual de la Policía: caivirtual.policia.gov.co. El CAI Virtual no reemplaza la denuncia formal.',
  'Cuando tengas el número de denuncia, consérvalo: con él puedes consultar el caso y sustentar reclamos ante tu banco.',
]

// Los canales se deben confirmar en sus sitios oficiales: pueden cambiar.
export const STEPS: Record<ReportType, string[]> = {
  suplantacion_entidad: [
    'Llama ya a tu banco o billetera por el número oficial impreso en tu tarjeta o en su app (nunca por uno que llegó en un mensaje). Pide bloquear productos y que te den un número de radicado.',
    'Cambia tus claves desde la app oficial y no compartas códigos ni tokens con nadie.',
    ...COMMON_LAST,
    'Si el banco no responde, puedes escalar tu queja al Defensor del Consumidor Financiero de la entidad y a la Superintendencia Financiera de Colombia.',
  ],
  robo_cuenta: [
    'Recupera tu cuenta desde la app oficial de WhatsApp (verificando tu número). Si no puedes, escribe a soporte desde la propia app.',
    'Avisa a tus contactos que no atiendan pedidos de dinero hechos desde tu número.',
    'Si perdiste la señal de tu línea de repente, llama a tu operador por su línea oficial: pueden haber duplicado o portado tu SIM para quedarse con tus códigos. Pide bloquear la SIM y avisa a tus bancos.',
    'Activa la verificación en dos pasos y cambia las claves de las redes asociadas.',
    ...COMMON_LAST,
  ],
  compra_prestamo_falso: [
    'Si pagaste, reclama a la plataforma o entidad por la que enviaste el dinero (banco, billetera o pasarela) y pide un número de radicado.',
    'Recuerda: un comprobante o captura no prueba que un pago llegó. Solo cuenta lo que ves en la app o en la oficina de tu propio banco.',
    'No hagas más pagos ni depósitos para "desbloquear" el producto o el préstamo.',
    'Para compras en línea, puedes presentar una queja ante la Superintendencia de Industria y Comercio (SIC).',
    ...COMMON_LAST,
  ],
  generico: [
    'Guarda las pruebas: capturas, enlaces, números y comprobantes. No borres los chats.',
    'Si hubo movimiento de dinero, avisa de inmediato a tu banco o billetera.',
    ...COMMON_LAST,
  ],
}
