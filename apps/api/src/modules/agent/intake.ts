import type { Db } from '../../db/client.ts'
import type { OcrGateway } from '../../gateways/ocr.ts'
import { isSupportedImage } from '../../gateways/ocr.ts'
import type { SpeechGateway } from '../../gateways/speech.ts'
import { AppError, badRequest } from '../../lib/errors.ts'
import { hit } from '../../lib/rateLimit.ts'
import { COST } from '../credits/costs.ts'
import type { AgentService } from './service.ts'

const MAX_TEXT = 4000

export type IntakeDeps = { db: Db; agent: AgentService; speech: SpeechGateway | null; ocr: OcrGateway }

// Convierte voz e imágenes en texto y lo pasa al mismo análisis que el texto escrito.
export function createIntakeService({ db, agent, speech, ocr }: IntakeDeps) {
  // La voz y el OCR cuestan CPU o dinero: se limitan y se verifica el saldo antes de usarlos.
  async function guard(userId: number, channel: 'voice' | 'image') {
    await hit(db, `media:${userId}`, 10, 60, 'Vas muy rápido. Espera un momento')
    // Se cobra antes de usar voz u OCR; si algo falla se reembolsa.
    return agent.reserve(userId, COST.analyzeVoiceOrImage, channel)
  }

  return {
    /** Solo pasa la voz a texto (sin analizar ni cobrar): el asistente decide luego qué hacer con lo que dijo. */
    async transcribe(userId: number, audio: Buffer, contentType: string) {
      if (!speech) throw new AppError(503, 'voice_unavailable', 'La voz no está disponible por ahora')
      await hit(db, `media:${userId}`, 10, 60, 'Vas muy rápido. Espera un momento')
      let transcript: string
      try {
        transcript = await speech.transcribe(audio, contentType)
      } catch (err) {
        console.error('Fallo de voz a texto:', err instanceof Error ? err.message : 'desconocido')
        throw new AppError(502, 'voice_failed', 'No pudimos escuchar el audio. Intenta de nuevo')
      }
      if (!transcript.trim()) throw badRequest('no_speech', 'No escuché nada. Intenta hablar más cerca del micrófono')
      return transcript.slice(0, MAX_TEXT)
    },

    async fromAudio(userId: number, audio: Buffer, contentType: string) {
      if (!speech) throw new AppError(503, 'voice_unavailable', 'La voz no está disponible por ahora')
      const reservation = await guard(userId, 'voice')
      let transcript: string
      try {
        transcript = await speech.transcribe(audio, contentType)
      } catch (err) {
        console.error('Fallo de voz a texto:', err instanceof Error ? err.message : 'desconocido')
        await agent.refund(userId, reservation)
        throw new AppError(502, 'voice_failed', 'No pudimos escuchar el audio. Intenta de nuevo')
      }
      if (!transcript) {
        await agent.refund(userId, reservation)
        throw badRequest('no_speech', 'No escuché nada. Intenta hablar más cerca del micrófono')
      }
      const result = await agent.analyze(userId, transcript.slice(0, MAX_TEXT), { cost: COST.analyzeVoiceOrImage, channel: 'voice', reservation })
      return { ...result, transcript }
    },

    async fromImage(userId: number, image: Buffer) {
      if (!isSupportedImage(image)) throw badRequest('bad_image', 'Sube una imagen PNG, JPG o WebP')
      const reservation = await guard(userId, 'image')
      let text: string
      try {
        text = await ocr.recognize(image)
      } catch (err) {
        console.error('Fallo del OCR:', err instanceof Error ? err.message : 'desconocido')
        await agent.refund(userId, reservation)
        if (err instanceof AppError) throw err
        throw new AppError(502, 'ocr_failed', 'No pudimos leer la imagen. Intenta con otra captura')
      }
      // Una foto sin mensaje (paisaje, selfie) puede dar letras sueltas al OCR: se exigen palabras de verdad.
      if ((text.match(/\p{L}{3,}/gu) ?? []).length < 4) {
        await agent.refund(userId, reservation)
        throw badRequest('no_text', 'No encontré texto en esa imagen, así que no puedo decirte si es una estafa. Mándame una captura del mensaje o escríbelo.')
      }
      const result = await agent.analyze(userId, text.slice(0, MAX_TEXT), { cost: COST.analyzeVoiceOrImage, channel: 'image', reservation })
      return { ...result, extractedText: text.slice(0, MAX_TEXT) }
    },

    /** Lee un texto en voz alta (por ejemplo el veredicto). Gratis, pero con límite por usuario. */
    async speak(userId: number, text: string) {
      if (!speech) throw new AppError(503, 'voice_unavailable', 'La voz no está disponible por ahora')
      await hit(db, `speak:${userId}`, 30, 60, 'Vas muy rápido. Espera un momento')
      try {
        return await speech.speak(text)
      } catch (err) {
        console.error('Fallo de texto a voz:', err instanceof Error ? err.message : 'desconocido')
        throw new AppError(502, 'voice_failed', 'No pudimos generar la voz. Intenta de nuevo')
      }
    },
  }
}

export type IntakeService = ReturnType<typeof createIntakeService>
