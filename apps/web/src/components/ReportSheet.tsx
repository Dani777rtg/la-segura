import { Icon } from './Icon';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, formatWait } from '../api/client';
import { CHANNELS, type ReportBody, type ReportCreated } from '../api/types';
import { FormError } from './ui';
import { ReportActions } from './ReportActions';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Hoja con formulario corto (todo opcional) y pantalla de éxito. */
export function ReportSheet({ caseId, onClose, onCreated }: { caseId: number; onClose: () => void; onCreated: () => void }) {
  const [date, setDate] = useState('');
  const [channel, setChannel] = useState('');
  const [amount, setAmount] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReportCreated | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError('');
    if (date && date > today()) { setError('La fecha no puede ser futura.'); return; }
    if (amount && !/^\d+$/.test(amount)) { setError('Escribe el monto solo con números, sin puntos ni signos.'); return; }
    const body: ReportBody = { caseId };
    if (date) body.occurredAt = date;
    if (channel) body.channel = channel;
    if (amount) body.amountCop = Number(amount);
    if (details.trim()) body.details = details.trim();
    setBusy(true);
    try {
      const r = await api.createReport(body);
      setDone(r);
      onCreated();
    } catch (e) {
      if (!(e instanceof ApiError)) setError('No pudimos armar el reporte. Intenta de nuevo.');
      else if (e.status === 402) setError('No te alcanzan los créditos para armar el reporte.');
      else if (e.status === 429) setError(e.retryAfterSec ? `${e.message} (${formatWait(e.retryAfterSec)})` : e.message);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/50">
      <div role="dialog" aria-modal="true" aria-labelledby="rs-title"
        className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="rs-title" className="text-xl font-bold">{done ? 'Tu reporte quedó listo' : 'Arma tu reporte'}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid min-h-[56px] min-w-[56px] place-items-center rounded-2xl border-2 border-line"><Icon name="x" size={26} /></button>
        </div>
        {done ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 rounded-2xl bg-ok-bg p-3 font-bold text-ok"><Icon name="checkCircle" />Código: {done.code}</p>
            {!done.created && <p className="text-sm text-muted">Ya tenías un reporte de este caso. No te cobramos otra vez.</p>}
            <ReportActions id={done.id} code={done.code} />
            <p className="text-sm font-bold">
              Este PDF es un soporte para llevar a tu banco, a ADenunciar o a la Fiscalía. No es la denuncia en sí.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted">Todo es opcional. Cuéntanos lo que quieras.</p>
            <div>
              <label htmlFor="rs-date" className="label">¿Cuándo pasó?</label>
              <input id="rs-date" type="date" className="input" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rs-channel" className="label">¿Por dónde llegó?</label>
              <select id="rs-channel" className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">Prefiero no decir</option>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rs-amount" className="label">¿Perdiste dinero? Monto en pesos</label>
              <input id="rs-amount" className="input" inputMode="numeric" placeholder="Ej: 150000" value={amount}
                onChange={(e) => setAmount(e.target.value.trim())} />
            </div>
            <div>
              <label htmlFor="rs-details" className="label">¿Algo más que quieras contar?</label>
              <textarea id="rs-details" className="input min-h-[100px] py-3" maxLength={600} value={details}
                onChange={(e) => setDetails(e.target.value)} />
            </div>
            {error && <FormError>{error}</FormError>}
            <p className="font-bold">Costo: 5 créditos</p>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Armando…' : 'Armar mi reporte'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
