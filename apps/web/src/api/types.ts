export interface User {
  id: number;
  name: string;
  phone: string;
  municipalityCode: string;
  localityId: number | null;
  credits: number;
}
export interface Municipality { code: string; name: string; dept: string }
export interface Locality { id: number; name: string }
export interface CodeSent { phone: string; expiresInSec: number }

export type Risk = 'alto' | 'medio' | 'bajo';
export type Level = 'muy_probable' | 'probable' | 'posible' | 'poco_probable';
export interface Source { name: string; result: 'ok' | 'flag' | 'simulated' | 'unavailable' | 'unverified'; detail: string }
export interface AnalyzeResult {
  caseId: number;
  risk: Risk;
  level: Level;
  fraudType: string;
  summary: string;
  reasons: string[];
  advice: string[];
  sources: Source[];
  offerReport: boolean;
  creditsLeft: number;
  transcript?: string;
  extractedText?: string;
}
export interface RegisterBody {
  name: string; phone: string; password: string; municipalityCode: string; localityId?: number;
}

export const CHANNELS = ['WhatsApp', 'SMS', 'Llamada', 'Correo', 'Redes sociales', 'Sitio web', 'Otro'] as const;
export interface ReportBody {
  caseId: number; occurredAt?: string; channel?: string; amountCop?: number; details?: string;
}
export interface Published { id?: number; body?: string; created: boolean }
export interface ReportCreated { id: number; code: string; created: boolean }
export interface Report { id: number; code: string; type: string; caseId: number; createdAt: string }

export type PostKind = 'estafaron' | 'intentaron';
export const FRAUD_TYPES: Record<string, string> = {
  suplantacion_entidad: 'Suplantación de banco o entidad',
  robo_whatsapp: 'Robo de cuenta de WhatsApp o redes',
  sim_swapping: 'Duplicado o cambio de SIM',
  tienda_falsa: 'Tienda o venta falsa',
  prestamo_falso: 'Préstamo falso o gota a gota digital',
  pago_falso: 'Pago falso o "consigné por error"',
  citacion_falsa: 'Citación o notificación falsa',
  inversion_falsa: 'Inversión o premio falso',
  otro: 'Posible estafa',
};
export interface Post {
  id: number; kind: PostKind; body: string; fraudType: string | null; createdAt: string;
  author: string; place: string; confirms: number; confirmedByMe: boolean; mine: boolean; demo: boolean; near?: boolean;
}
export interface PostsPage { items: Post[]; nextCursor: string | null; area?: string | null }
export interface PostBody { kind: PostKind; text: string; fraudType?: string }

export interface Lookup {
  kind: 'phone' | 'domain'; display: string; reporters: number;
  firstReportedAt: string | null; lastReportedAt: string | null;
  level: 'sin_reportes' | 'alerta' | 'peligro'; notes: Source[]; disclaimer: string;
}

export interface Territory {
  windowDays: number; minCell: number; total: number; bogotaTotal: number;
  localities: { id: number; name: string; count: number | null }[];
  municipalities: { code: string; name: string; dept: string; lat: number; lon: number; count: number }[];
  byType: { fraudType: string; count: number }[];
  daily: { date: string; count: number }[];
  includesDemo: boolean;
}

export interface Credits {
  balance: number;
  pack: { credits: number; baseCop: number; ivaCop: number; totalCop: number };
  costs: { analyzeText: number; analyzeVoiceOrImage: number; pdfReport: number };
  history: { delta: number; reason: string; createdAt: string }[];
}

/** Respuesta del asistente (el mismo de WhatsApp): texto y, si revisó algo, el análisis completo. */
export interface AssistantReply {
  reply: string;
  analysis?: AnalyzeResult & { transcript?: string; extractedText?: string };
  action?: 'report';
  caseId?: number;
  transcript?: string;
  extractedText?: string;
}
export interface ChatItem { id: number; role: 'user' | 'assistant'; content: string; channel: string; createdAt: string }
