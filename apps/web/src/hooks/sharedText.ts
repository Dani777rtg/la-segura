// Texto compartido (solo texto, nunca credenciales) que sobrevive a un paso por /entrar.
const KEY = 'ps_shared_text';
export const saveSharedText = (t: string) => {
  try { sessionStorage.setItem(KEY, t); } catch { /* sin storage */ }
};
export function takeSharedText(): string {
  try {
    const t = sessionStorage.getItem(KEY) ?? '';
    sessionStorage.removeItem(KEY);
    return t;
  } catch {
    return '';
  }
}
