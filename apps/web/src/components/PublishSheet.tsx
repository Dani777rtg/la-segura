import { Icon } from './Icon';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../api/client';
import { FRAUD_TYPES, type AnalyzeResult, type Published } from '../api/types';
import { FormError } from './ui';

/** Confirmación corta para avisar a los vecinos (publica la alerta en Comunidad). */
export function PublishSheet({ r, onClose, onPublished }: { r: AnalyzeResult; onClose: () => void; onPublished: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Published | null>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); prev?.focus?.(); };
  }, [onClose]);

  useEffect(() => { first.current?.focus(); }, [done]);

  const publish = async () => {
    setBusy(true);
    setError('');
    try {
      setDone(await api.publishCase(r.caseId));
      onPublished();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/50">
      <div role="dialog" aria-modal="true" aria-labelledby="pb-title"
        className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-card p-5">
        <h2 id="pb-title" className="text-xl font-bold">Avisar a mis vecinos</h2>
        {done ? (
          <div className="space-y-4" role="status">
            <p className="rounded-2xl bg-ok-bg p-3 font-bold text-ok">
              <span className="flex items-center gap-2"><Icon name="checkCircle" />{done.created ? 'Listo, tus vecinos ya ven la alerta' : 'Esa alerta ya estaba publicada'}</span>
            </p>
            {done.created && done.body && <p className="whitespace-pre-wrap rounded-2xl bg-bg p-3">{done.body}</p>}
            <Link to="/app" className="btn-primary">Ver en Inicio</Link>
            <button type="button" ref={first} className="btn-ghost" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <div className="space-y-4">
            <p>
              Se publicará en la red como "Un vecino": <i>{FRAUD_TYPES[r.fraudType] ?? FRAUD_TYPES.otro}: {r.summary}</i>.
              {' '}No incluye tu nombre ni tu número. ¿Publicar?
            </p>
            {error && <FormError>{error}</FormError>}
            <button type="button" ref={first} className="btn-primary" disabled={busy} onClick={publish}>
              {busy ? 'Publicando…' : 'Sí, publicar'}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          </div>
        )}
      </div>
    </div>
  );
}
