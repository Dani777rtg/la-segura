import { useEffect, useRef, useState } from 'react';
import { api, errMsg } from '../api/client';
import { Icon } from './Icon';
import { FormError, Logo } from './ui';

/** Donar al proyecto: explica para qué es y lleva a Mercado Pago. Se cierra con Esc o tocando afuera. */
export function DonateSheet({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const donate = async () => {
    setBusy(true);
    setError('');
    try {
      window.location.href = (await api.donate()).url;
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="donate-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-t-3xl bg-card p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#fff4cc] text-[#9a5b00]"><Icon name="heart" size={30} /></span>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-12 w-12 place-items-center rounded-full bg-soft hover:bg-line">
            <Icon name="x" size={24} />
          </button>
        </div>
        <div className="space-y-2">
          <h2 id="donate-title" className="text-2xl font-semibold">Apoya a La Segura</h2>
          <p className="text-base text-muted">
            Tu donación ayuda a que más familias de Bosa y de Colombia revisen mensajes, consulten números y denuncien estafas sin pagar.
          </p>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-soft px-4 py-3">
          <span className="flex items-center gap-2 text-base font-medium"><Logo size={28} /> Donación al proyecto</span>
          <span className="text-xl font-semibold">$500.000 <span className="text-sm font-normal text-muted">COP</span></span>
        </div>
        {error && <FormError>{error}</FormError>}
        <button ref={first} type="button" className="btn btn-sun" onClick={() => void donate()} disabled={busy}>
          {busy ? 'Abriendo Mercado Pago…' : 'Donar con Mercado Pago'}
        </button>
        <p className="text-center text-sm text-muted">El pago es seguro y lo procesa Mercado Pago. No guardamos datos de tu tarjeta.</p>
      </div>
    </div>
  );
}
