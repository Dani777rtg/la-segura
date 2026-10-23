import type { CaseSource } from '../../db/schema.ts'
import type { Signal } from './signals.ts'

export type Risk = 'alto' | 'medio' | 'bajo'

const sourceFlagged = (sources: CaseSource[], prefix: string) =>
  sources.some((s) => s.name.startsWith(prefix) && s.result === 'flag')

/**
 * Riesgo mínimo que dicen las pruebas objetivas, sin IA. La IA puede subirlo, nunca bajarlo.
 *  - alto: está en la lista de phishing, o dos señales graves a la vez.
 *  - medio: una señal grave, un dominio muy nuevo, la comunidad ya lo reportó o dos señales leves.
 */
export function assessRules(signals: Signal[], sources: CaseSource[]): Risk {
  const heavy = signals.filter((s) => s.weight === 'alto').length
  const light = signals.filter((s) => s.weight === 'medio').length
  if (sourceFlagged(sources, 'Lista pública de phishing') || heavy >= 2) return 'alto'
  if (heavy >= 1 || light >= 2 || sourceFlagged(sources, 'Antigüedad') || sourceFlagged(sources, 'Reportes de la comunidad')) {
    return 'medio'
  }
  return 'bajo'
}
