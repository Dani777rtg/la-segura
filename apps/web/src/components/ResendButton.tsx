import { useEffect, useState } from 'react';
import { api, ApiError, formatWait } from '../api/client';
import { useCountdown } from '../hooks/useCountdown';

/** Reenvío de código: bloqueado mientras corra la cuenta regresiva (segundos del servidor). */
export function ResendButton({ phone, initialWait }: { phone: string; initialWait: number }) {
  const { remaining, start } = useCountdown(initialWait);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { start(initialWait); }, [initialWait, start]);

  const resend = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api.resendCode(phone);
      start(60); // regla de negocio: un código por minuto por celular
      setMsg(`Listo, te enviamos otro código (${r.phone}).`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) start(e.retryAfterSec ?? 60);
      setMsg(e instanceof ApiError ? e.message : 'No pudimos reenviar el código.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button type="button" className="btn-ghost" disabled={busy || remaining > 0} onClick={resend}>
        {remaining > 0 ? `Podrás pedir otro código en ${formatWait(remaining)}` : 'Reenviar código'}
      </button>
      {msg && <p role="status" className="text-center text-sm font-semibold">{msg}</p>}
    </div>
  );
}
