import type { Risk } from './rules.ts'

// El nivel se dice con palabras y se apoya en EVIDENCIA, no en un número inventado:
//  - "muy probable": el modelo y las pruebas objetivas (lista de phishing, dominio imitador, varias señales graves,
//    reportes de la comunidad) coinciden en que es riesgo alto.
//  - "probable": el riesgo es alto pero solo por el criterio del modelo y las señales del texto.
//  - "posible": hay señales de alerta, pero no concluyentes.
//  - "poco_probable": no se ven señales claras (NUNCA se dice "seguro").
export type Level = 'muy_probable' | 'probable' | 'posible' | 'poco_probable'

export function levelFor(risk: Risk, objectiveFloor: Risk): Level {
  if (risk === 'alto') return objectiveFloor === 'alto' ? 'muy_probable' : 'probable'
  if (risk === 'medio') return 'posible'
  return 'poco_probable'
}

export const LEVEL_LABEL: Record<Level, string> = {
  muy_probable: 'Muy probable que sea una estafa',
  probable: 'Probablemente es una estafa',
  posible: 'Podría ser una estafa',
  poco_probable: 'Poco probable, pero no puedo asegurar que sea seguro',
}

/** Para casos guardados antes de que existiera el nivel. */
export function levelFromRisk(risk: string): Level {
  return risk === 'alto' ? 'probable' : risk === 'medio' ? 'posible' : 'poco_probable'
}
