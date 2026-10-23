import { useState, type FormEvent } from 'react';
import { api, errMsg } from '../api/client';
import { FRAUD_TYPES, type PostKind } from '../api/types';
import { FormError } from './ui';

export const MIN = 10;
export const MAX = 600;

export function PostForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<PostKind>('intentaron');
  const [fraudType, setFraudType] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [published, setPublished] = useState<string | null>(null);
  const len = text.trim().length;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (len < MIN) { setError(`Cuéntanos un poco más (mínimo ${MIN} letras).`); return; }
    if (len > MAX) { setError(`Es muy largo: máximo ${MAX} letras.`); return; }
    setBusy(true);
    setError('');
    try {
      const r = await api.createPost({ kind, text: text.trim(), ...(fraudType ? { fraudType } : {}) });
      setPublished(r.body);
    } catch (e) {
      setError(errMsg(e)); // 422 post_rejected trae un mensaje amable
    } finally {
      setBusy(false);
    }
  };

  if (published !== null) {
    return (
      <div className="space-y-3 border-t border-line pt-4" role="status">
        <p className="font-bold">¡Gracias por avisar!</p>
        <p className="text-sm text-muted">Esto fue lo que publicamos (quitamos datos personales):</p>
        <p className="quote whitespace-pre-wrap">{published}</p>
        <button type="button" className="btn-primary" onClick={onDone}>Listo</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 border-t border-line pt-4" noValidate>
      <fieldset>
        <legend className="label">¿Qué pasó?</legend>
        <div className="grid grid-cols-2 gap-2">
          {([['intentaron', 'Me intentaron estafar'], ['estafaron', 'Me estafaron']] as const).map(([k, l]) => (
            <label key={k} className={`flex min-h-[52px] cursor-pointer items-center justify-center rounded-xl border-2 px-2 text-center text-base font-semibold ${kind === k ? 'border-brand bg-brand-soft text-brand' : 'border-line'}`}>
              <input type="radio" name="kind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="ftype" className="label">Tipo de estafa (opcional)</label>
        <select id="ftype" className="input" value={fraudType} onChange={(e) => setFraudType(e.target.value)}>
          <option value="">No sé / prefiero no decir</option>
          {Object.entries(FRAUD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ptext" className="label">Cuenta lo que te pasó</label>
        <textarea id="ptext" className="input min-h-[140px] py-3" value={text} onChange={(e) => setText(e.target.value)}
          aria-describedby="pcount" aria-invalid={error ? true : undefined} />
        <p id="pcount" className={`mt-1 text-sm ${len > MAX ? 'font-bold text-danger' : 'text-muted'}`}>
          {len}/{MAX} · No pongas celulares, cédulas ni nombres.
        </p>
      </div>
      {error && <FormError>{error}</FormError>}
      <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Publicando…' : 'Publicar'}</button>
      <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
    </form>
  );
}
