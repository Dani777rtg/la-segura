import { Icon, type IconName } from '../components/Icon';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api/client';
import type { Credits as CreditsData } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useLoad } from '../hooks/useLoad';
import { FormError } from '../components/ui';

export const cop = (n: number) => `$${n.toLocaleString('es-CO')}`;
const REASON: Record<string, string> = {
  welcome: 'Regalo de bienvenida', analyze_web: 'Análisis', analyze_voice: 'Análisis', analyze_image: 'Análisis',
  pdf_report: 'Reporte en PDF', purchase: 'Compra de créditos',
};
const STATUS: Record<string, { icon: IconName; text: string; box: string }> = {
  success: { icon: 'checkCircle', text: 'Pago recibido. Tus créditos se acreditan en unos segundos.', box: 'border-ok bg-ok-bg text-ok' },
  pending: { icon: 'clock', text: 'Tu pago está pendiente. Cuando se confirme, verás los créditos aquí.', box: 'border-warn bg-warn-bg text-warn' },
  failure: { icon: 'alert', text: 'No se pudo completar el pago. No te cobramos; puedes intentar de nuevo.', box: 'border-danger bg-danger-bg text-danger' },
};

export function PriceBreakdown({ pack }: { pack: CreditsData['pack'] }) {
  return (
    <p className="font-bold">{cop(pack.baseCop)} + IVA 19% ({cop(pack.ivaCop)}) = <span className="text-xl font-bold">{cop(pack.totalCop)} COP</span></p>
  );
}

export default function Credits() {
  const { setUser } = useAuth();
  const status = useSearchParams()[0].get('status') ?? '';
  const { data, error, loading, reload } = useLoad(() => api.credits());
  const [balance, setBalance] = useState<number | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [buyError, setBuyError] = useState('');

  useEffect(() => { if (data) setBalance(data.balance); }, [data]);

  // Pago aprobado: el webhook puede tardar; reintenta cada 3 s, hasta 5 veces.
  useEffect(() => {
    if (status !== 'success' || !data) return;
    let n = 0;
    const start = data.balance;
    const id = setInterval(async () => {
      n += 1;
      try {
        const c = await api.credits();
        setBalance(c.balance);
        if (c.balance > start) { clearInterval(id); void reload(); api.me().then(setUser).catch(() => undefined); }
      } catch { /* se reintenta */ }
      if (n >= 5) clearInterval(id);
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, !!data]);

  const buy = async () => {
    setRedirecting(true);
    setBuyError('');
    try {
      const { url } = await api.checkout();
      window.location.assign(url);
    } catch (e) {
      setBuyError(errMsg(e));
      setRedirecting(false);
    }
  };

  const st = STATUS[status];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mis créditos</h1>
      {st && <p role="status" className={`flex items-start gap-2.5 rounded-2xl border-2 p-4 font-bold ${st.box}`}><Icon name={st.icon} />{st.text}</p>}
      {loading && <p role="status" className="font-bold">Cargando…</p>}
      {error && <FormError>{error}</FormError>}
      {data && (
        <>
          <section className="card text-center" aria-label="Saldo">
            <p className="text-sm text-muted">Tu saldo</p>
            <p className="flex items-center gap-3 text-5xl font-bold text-brand"><Icon name="coins" size={44} />{balance ?? data.balance}</p>
            <p className="mt-2 text-sm text-muted">Los 200 créditos de bienvenida alcanzan para probar.</p>
          </section>
          <section className="card space-y-1" aria-label="Cuánto cuesta cada cosa">
            <h2 className="font-bold">¿Cuánto cuesta cada cosa?</h2>
            <ul className="space-y-1">
              <li>Analizar un texto: <b>{data.costs.analyzeText} crédito</b></li>
              <li>Analizar una voz o una captura: <b>{data.costs.analyzeVoiceOrImage} créditos</b></li>
              <li>Reporte en PDF: <b>{data.costs.pdfReport} créditos</b></li>
              <li>Consultar antes de pagar: <b>gratis</b></li>
            </ul>
          </section>
          <section className="card space-y-3" aria-label="Paquete de créditos">
            <h2 className="text-xl font-bold">{data.pack.credits.toLocaleString('es-CO')} créditos</h2>
            <PriceBreakdown pack={data.pack} />
            <button type="button" className="btn-primary" onClick={buy} disabled={redirecting}>
              {redirecting ? 'Te estamos llevando…' : 'Comprar con Mercado Pago'}
            </button>
            {buyError && <FormError>{buyError}</FormError>}
          </section>
          <section aria-label="Historial">
            <h2 className="mb-2 font-bold">Historial</h2>
            {data.history.length === 0 ? <p className="text-muted">Todavía no hay movimientos.</p> : (
              <ul className="divide-y divide-line rounded-3xl border border-line bg-card">
                {data.history.map((h, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 p-3">
                    <span>
                      <span className="block font-bold">{REASON[h.reason] ?? h.reason}</span>
                      <span className="text-sm text-muted">{new Date(h.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</span>
                    </span>
                    <span className={`font-bold ${h.delta > 0 ? 'text-ok' : ''}`}>{h.delta > 0 ? '+' : ''}{h.delta}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
