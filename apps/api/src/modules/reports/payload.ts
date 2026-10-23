import type { ReportType } from './guidance.ts'

// Lo que se firma en la cadena de hashes. Se guarda tal cual en reports.payload.
export type ReportPayload = {
  v: 1
  code: string
  type: ReportType
  createdAt: string
  reporter: { name: string }
  location: { municipality: string; department: string; locality?: string }
  // Los reportes antiguos traen `confidence` y no `level`: el PDF lo tolera.
  analysis: { caseId: number; risk: string; level?: string; confidence?: number; fraudType: string; summary: string }
  narrative: string
  occurredAt?: string
  channel?: string
  amountCop?: number
  details?: string
  evidence: { domains: string[]; phones: string[] }
  receivedText: string
}
