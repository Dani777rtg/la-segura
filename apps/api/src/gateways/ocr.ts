import { fileURLToPath } from 'node:url'
import { createWorker, type Worker } from 'tesseract.js'
import { AppError } from '../lib/errors.ts'

// OCR local con Tesseract (DeepSeek no ve imágenes). El modelo de español viene en el repo (apps/api/ocr).
export interface OcrGateway {
  recognize(image: Buffer): Promise<string>
}

export class FakeOcr implements OcrGateway {
  text = 'texto de prueba'
  async recognize() {
    return this.text
  }
}

const MAX_PENDING = 20

class TesseractOcr implements OcrGateway {
  private worker: Promise<Worker> | null = null
  // ponytail: un solo worker con cola; si el OCR se vuelve cuello de botella, usar createScheduler con N workers.
  private queue: Promise<unknown> = Promise.resolve()
  private pending = 0

  private getWorker() {
    this.worker ??= createWorker('spa', 1, {
      langPath: fileURLToPath(new URL('../../ocr', import.meta.url)),
      gzip: false,
      cacheMethod: 'none',
    })
    return this.worker
  }

  recognize(image: Buffer) {
    // Cola acotada: si hay demasiadas capturas esperando, se rechaza en vez de acumular memoria.
    if (this.pending >= MAX_PENDING) throw new AppError(503, 'ocr_busy', 'Estamos leyendo muchas capturas. Intenta en un momento')
    this.pending++
    const run = this.queue.then(async () => {
      const worker = await this.getWorker()
      const { data } = await worker.recognize(image)
      return data.text.trim()
    })
    this.queue = run.catch(() => undefined).finally(() => void this.pending--)
    return run
  }
}

export const createOcr = (): OcrGateway => new TesseractOcr()

/** Comprueba la firma del archivo: no se confía en el Content-Type que declara el cliente. */
export function isSupportedImage(buf: Buffer): boolean {
  const png = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const jpeg = buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  const webp = buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP'
  return png || jpeg || webp
}
