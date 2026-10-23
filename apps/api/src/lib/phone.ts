// Celulares colombianos: 10 dígitos que empiezan por 3. Se guardan como 57 + número, sin "+".
export function normalizeColombianMobile(input: string): string | null {
  const digits = input.replace(/[\s()+-]/g, '')
  const national = digits.startsWith('57') && digits.length === 12 ? digits.slice(2) : digits
  return /^3\d{9}$/.test(national) ? `57${national}` : null
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}•••••${phone.slice(-3)}`
}

// "Medellín" → "medellin": para autocompletar sin tildes ni mayúsculas.
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}
