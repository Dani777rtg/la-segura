import { useCallback, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { MarkedMessage } from './Marked';
import { PublishSheet } from './PublishSheet';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { useSpeak } from '../hooks/useSpeak';
import { FormError } from './ui';
import { ReportSheet } from './ReportSheet';
import type { AnalyzeResult, Level, Source } from '../api/types';

// El veredicto es un titular grande. El color solo acompaña; el texto siempre dice el nivel.
const LEVEL: Record<Level, { title: string; icon: IconName; box: string }> = {
  muy_probable: { title: 'Muy probable que sea una estafa', icon: 'stopSign', box: 'bg-danger-bg text-danger' },
  probable: { title: 'Probablemente es una estafa', icon: 'ban', box: 'bg-danger-bg text-danger' },
  posible: { title: 'Podría ser una estafa', icon: 'alert', box: 'bg-warn-bg text-warn' },
  poco_probable: { title: 'Poco probable, pero no puedo asegurar que sea seguro', icon: 'info', box: 'bg-soft text-ink' },
};

const SRC: Record<Source['result'], { icon: IconName; text: string }> = {
  ok: { icon: 'check', text: 'Sin alertas' }, flag: { icon: 'alert', text: 'Alerta' },
  simulated: { icon: 'flask', text: 'Simulación' }, unavailable: { icon: 'clock', text: 'No pudimos consultar' }, unverified: { icon: 'info', text: 'No verificado' },
};

export function RiskCard({ r, message, messageLabel }: { r: AnalyzeResult; message?: string; messageLabel?: string }) {
  const s = LEVEL[r.level];
  const { setUser } = useAuth();
  const [sheet, setSheet] = useState(false);
  const [pub, setPub] = useState(false);
  const closePub = useCallback(() => setPub(false), []);
  const [posted, setPosted] = useState(false);
  const speak = useSpeak([r.summary, ...r.advice.slice(0, 2)].join('. '));
  const refreshCredits = () => { api.me().then(setUser).catch(() => undefined); };
  const hot = r.risk !== 'bajo';
  return (
    <section aria-label="Resultado del análisis" className="space-y-6">
      <div role="status" className="space-y-3">
        <div className={`flex items-start gap-3 rounded-xl p-4 ${s.box}`}>
          <Icon name={s.icon} size={32} className="mt-0.5" />
          <h2 className="text-2xl font-semibold leading-tight">{s.title}</h2>
        </div>
        <p className="text-lg leading-snug">{r.summary}</p>
      </div>
      <button type="button" className="btn-ghost" onClick={speak.toggle} aria-pressed={speak.state === 'playing'}>
        {speak.state === 'loading' ? <><Icon name="clock" />Cargando audio…</> : speak.state === 'playing' ? <><Icon name="stop" />Detener</> : <><Icon name="volume" />Escuchar</>}
      </button>
      {speak.error && <FormError>{speak.error}</FormError>}

      {message && message.trim().length > 0 && <MarkedMessage text={message} label={messageLabel ?? 'Tu mensaje, con las trampas marcadas'} />}

      {r.advice.length > 0 && (
        <div>
          <h3 className="mb-2 text-xl font-bold">Qué hacer ahora</h3>
          <ol className="space-y-3">
            {r.advice.slice(0, 3).map((x, i) => (
              <li key={x} className="flex gap-3 text-lg leading-snug">
                <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-base font-semibold text-brand-ink">{i + 1}</span>
                <span className="pt-0.5">{x}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {r.reasons.length > 0 && (
        <div>
          <h3 className="mb-2 text-xl font-bold">¿Por qué?</h3>
          <ul className="list-disc space-y-1.5 pl-6 text-lg">{r.reasons.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}

      {r.offerReport && (
        <div className="space-y-3 border-t border-line pt-5">
          {hot && <p className="text-lg font-bold">¿Armo tu reporte?</p>}
          <button type="button" className={hot ? 'btn-primary' : 'btn-ghost'} onClick={() => setSheet(true)}>Armar mi reporte</button>
          <button type="button" className="btn-ghost" disabled={posted} onClick={() => setPub(true)}>Avisar a mis vecinos</button>
        </div>
      )}

      {r.sources.length > 0 && (
        <details className="border-t border-line pt-4">
          <summary className="flex min-h-[48px] cursor-pointer items-center text-lg font-bold">Lo que revisamos</summary>
          <ul className="mt-2 space-y-3 text-base">
            {r.sources.map((x) => (
              <li key={x.name}>
                <span className="font-bold">{x.name}</span>{' '}
                <span className={`inline-flex items-center gap-1 ${x.result === 'simulated' ? 'rounded bg-line px-1.5 font-bold' : x.result === 'unavailable' || x.result === 'unverified' ? 'text-muted' : x.result === 'flag' ? 'font-bold text-danger' : 'font-bold text-ok'}`}><Icon name={SRC[x.result].icon} size={16} />{SRC[x.result].text}</span>
                <span className="block text-muted">{x.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {sheet && <ReportSheet caseId={r.caseId} onClose={() => setSheet(false)} onCreated={refreshCredits} />}
      {pub && <PublishSheet r={r} onClose={closePub} onPublished={() => setPosted(true)} />}
    </section>
  );
}
