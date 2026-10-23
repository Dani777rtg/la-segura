import { Icon, type IconName } from '../components/Icon';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api/client';
import type { Lookup as LookupResult, Source } from '../api/types';
import { FormError } from '../components/ui';

// Nunca verde ni "seguro": sin reportes solo significa que nadie ha avisado.
const LEVEL: Record<LookupResult['level'], { icon: IconName; title: string; box: string }> = {
  peligro: { icon: 'stopSign', title: 'Peligro: varias personas lo reportaron', box: 'border-danger bg-danger-bg text-danger' },
  alerta: { icon: 'alert', title: 'Ten cuidado', box: 'border-warn bg-warn-bg text-warn' },
  sin_reportes: { icon: 'info', title: 'Nadie lo ha reportado', box: 'border-line bg-soft text-ink' },
};
const SRC: Record<Source['result'], string> = { ok: 'Sin alertas', flag: 'Alerta', simulated: 'Simulación', unavailable: 'No pudimos consultar', unverified: 'No verificado' };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function Lookup() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [res, setRes] = useState<LookupResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (raw: string) => {
    const v = raw.trim();
    if (!v) { setError('Escribe el celular o el enlace a consultar.'); return; }
    setBusy(true);
    setError('');
    setRes(null);
    try {
      setRes(await api.lookup(v));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = (ev: FormEvent) => { ev.preventDefault(); void run(q); };
  // Llega desde el buscador de arriba o desde el Inicio con ?q=: se consulta de una vez.
  const fromUrl = params.get('q');
  useEffect(() => { if (fromUrl) { setQ(fromUrl); void run(fromUrl); } }, [fromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = res && LEVEL[res.level];
  return (
    <div className="space-y-5">
      <section className="card space-y-4">
      <h1 className="text-2xl font-semibold">¿Vas a pagar? Consulta primero</h1>
      <p className="text-muted">Mira si otras personas ya reportaron ese número de celular o ese enlace. Es gratis.</p>
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="q" className="label">Celular o enlace</label>
        <input id="q" className="input" inputMode="url" autoComplete="off" placeholder="Ej: 3001234567 o tienda-falsa.com"
          value={q} onChange={(e) => setQ(e.target.value)} aria-invalid={error ? true : undefined} />
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Consultando…' : 'Consultar'}</button>
      </form>
      {error && <FormError>{error}</FormError>}
      </section>
      {res && s && (
        <section aria-label="Resultado de la consulta" className="card space-y-4">
          <div className={`rounded-2xl border-2 p-4 ${s.box}`} role="status">
            <Icon name={s.icon} size={40} />
            <h2 className="text-2xl font-bold leading-tight">{s.title}</h2>
            <p className="mt-1 break-all font-bold">{res.display}</p>
          </div>
          <p className="font-bold">
            {res.reporters === 0 ? 'Todavía no hay reportes de este dato.'
              : `${res.reporters} ${res.reporters === 1 ? 'persona lo reportó' : 'personas lo reportaron'}.`}
          </p>
          {res.reporters > 0 && res.firstReportedAt && (
            <p className="text-sm text-muted">Primer reporte: {day(res.firstReportedAt)} · Último: {day(res.lastReportedAt)}</p>
          )}
          {res.notes.length > 0 && (
            <ul className="space-y-1 text-sm">
              {res.notes.map((n) => (
                <li key={n.name}>
                  <span className="font-bold">{n.name}</span> <span className="font-bold">{SRC[n.result]}</span>
                  <span className="block text-muted">{n.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="rounded-2xl bg-bg p-3 text-sm">{res.disclaimer}</p>
        </section>
      )}
    </div>
  );
}
