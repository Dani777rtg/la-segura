import type { Config } from '../config.ts'

// Voz: Deepgram (voz a texto y texto a voz).
export type AudioFormat = 'mp3' | 'ogg'

export interface SpeechGateway {
  transcribe(audio: Buffer, contentType: string): Promise<string>
  speak(text: string, format?: AudioFormat): Promise<Buffer>
}

export class FakeSpeech implements SpeechGateway {
  transcript = 'hola esto es una prueba'
  spoken: string[] = []
  async transcribe() {
    return this.transcript
  }
  async speak(text: string) {
    this.spoken.push(text)
    return Buffer.from('fake-audio')
  }
}

// Voz colombiana de Aura-2.
const VOICE = 'aura-2-celeste-es'

class DeepgramSpeech implements SpeechGateway {
  constructor(private readonly apiKey: string) {}

  async transcribe(audio: Buffer, contentType: string) {
    const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&language=es&smart_format=true', {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': contentType },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`Deepgram STT respondió ${res.status}`)
    const data = (await res.json()) as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } }
    return data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
  }

  async speak(text: string, format: AudioFormat = 'mp3') {
    // WhatsApp exige notas de voz en ogg/opus; la web usa mp3.
    const encoding = format === 'ogg' ? 'encoding=opus&container=ogg' : 'encoding=mp3'
    const res = await fetch(`https://api.deepgram.com/v1/speak?model=${VOICE}&${encoding}`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`Deepgram TTS respondió ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
}

export function createSpeech(cfg: Config): SpeechGateway | null {
  return cfg.DEEPGRAM_API_KEY ? new DeepgramSpeech(cfg.DEEPGRAM_API_KEY) : null
}
