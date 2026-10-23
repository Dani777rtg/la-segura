import { describe, expect, it } from 'vitest';
import { markTraps, timeAgo } from '../lib/traps';

describe('marcar trampas', () => {
  it('subraya el enlace, la amenaza y la clave, sin perder texto', () => {
    const text = 'Bancolombia: tu cuenta será bloqueada hoy. Entra a bancolombia-seguro.xyz y escribe tu clave dinámica.';
    const { segments, traps } = markTraps(text);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(traps.map((t) => t.key).sort()).toEqual(['enlace', 'pide_codigo', 'urgencia']);
    expect(segments.find((s) => s.trap?.key === 'enlace')?.text).toBe('bancolombia-seguro.xyz');
  });
  it('un mensaje normal no marca nada', () => {
    const r = markTraps('Hola mamá, llego a las 7 para la comida.');
    expect(r.traps).toHaveLength(0);
    expect(r.segments).toHaveLength(1);
  });
  it('dice el tiempo en palabras', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(timeAgo('2026-10-23T10:00:00Z', now)).toBe('hace 2 h');
    expect(timeAgo('2026-10-22T11:00:00Z', now)).toBe('ayer');
  });
});
