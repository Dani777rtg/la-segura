// Marca en el texto las trampas típicas de una estafa para enseñarlas a simple vista.
// ponytail: copia de los patrones de apps/api/src/modules/agent/signals.ts; si cambian allá, actualizar aquí.

export type Trap = { key: string; label: string };
export type Segment = { text: string; trap?: Trap };

const PATTERNS: Array<Trap & { re: RegExp }> = [
  { key: 'enlace', label: 'Enlace', re: /\b(enlace|link)\b|\bhttps?:\/\/[^\s]+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(xyz|top|click|shop|online|site|info|live|link|co|com|net)(\/[^\s]*)?/gi },
  { key: 'pide_codigo', label: 'Pide código o clave', re: /c[oó]digo (de )?(verificaci[oó]n|seguridad)|c[oó]digo que te lleg[oó]|\bel c[oó]digo\b|(ingres(ar|ara|e|es)|enviar?|mand(ar|ara|e)|dar|actualizar?) (mis|tus|sus) datos|clave (din[aá]mica|del cajero)|\bclave\b|\btoken\b|\bcvv\b|\bpin\b|n[uú]mero de (tu )?tarjeta/gi },
  { key: 'urgencia', label: 'Te apura', re: /urgente|de inmediato|[uú]ltimas horas|ser[aá] (bloquead|suspendid|cancelad)[ao]s?|(ha sido|est[aá]) (bloquead|suspendid)[ao]|bloquead[ao]|evita (el )?bloqueo|hoy mismo|ya mismo|r[aá]pido/gi },
  { key: 'premio', label: 'Premio falso', re: /ganaste|has ganado|premio|sorteo|felicitaciones/gi },
  { key: 'prestamo', label: 'Préstamo fácil', re: /(pr[eé]stamo|cr[eé]dito) (aprobado|inmediato|f[aá]cil)|sin (papeleo|centrales|codeudor|estudio)/gi },
  { key: 'comprobante', label: 'Pago "por error"', re: /comprobante|consign[eé] por error|consign(aron|[oó]|[eé]) de m[aá]s|devolv(iera|ieras|er) (la )?plata|se (hab[ií]an )?equivocad[oa]|devu[eé]lveme|transferencia (fallida|pendiente)/gi },
  { key: 'familiar', label: 'Falso familiar', re: /cambi[eé] de n[uú]mero|este es mi nuevo n[uú]mero|mi nuevo n[uú]mero/gi },
  { key: 'judicial', label: 'Citación falsa', re: /citaci[oó]n|demanda|juzgado|proceso (judicial|penal)|orden de captura|embargo/gi },
  { key: 'sim', label: 'Tu línea / SIM', re: /duplicado de (tu )?sim|cambio de sim|sim (duplicada|clonada)|portabilidad/gi },
  { key: 'inversion', label: 'Ganancias fáciles', re: /ganancias? (garantizad|aseguradas?)[ao]?s?|duplica(r)? tu dinero|inversi[oó]n segura/gi },
];

/** Parte el texto en tramos normales y tramos marcados como trampa (sin solaparse; gana el primero). */
export function markTraps(text: string): { segments: Segment[]; traps: Trap[] } {
  const hits: Array<{ start: number; end: number; trap: Trap }> = [];
  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const start = m.index ?? 0;
      let end = start + m[0].length;
      // Marca la palabra completa: "juzgado" dentro de "juzgados" subraya "juzgados".
      while (end < text.length && /\p{L}/u.test(text[end]!)) end++;
      if (m[0].length < 2 || hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ start, end, trap: { key: p.key, label: p.label } });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) segments.push({ text: text.slice(at, h.start) });
    segments.push({ text: text.slice(h.start, h.end), trap: h.trap });
    at = h.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  const traps = [...new Map(hits.map((h) => [h.trap.key, h.trap])).values()];
  return { segments, traps };
}

/** "hace 2 h", "hace 3 días": más fácil de leer que una fecha. */
export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? 'ayer' : `hace ${d} días`;
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}
