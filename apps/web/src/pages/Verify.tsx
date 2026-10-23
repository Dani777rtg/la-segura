import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ResendButton } from '../components/ResendButton';
import { AuthShell, Field } from '../components/ui';

interface VerifyState { phone: string; maskedPhone?: string; wait?: number }

export default function Verify() {
  const state = useLocation().state as VerifyState | null;
  const nav = useNavigate();
  const { setUser } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!state?.phone) return <Navigate to="/entrar" replace />;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('Escribe los 6 números del código.'); return; }
    setBusy(true);
    setError('');
    try {
      setUser(await api.verify(state.phone, code));
      nav('/app', { replace: true });
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? 'Fallaste muchas veces. Pide un código nuevo y vuelve a intentar.'
          : e instanceof ApiError ? e.message : 'No pudimos verificar el código.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Revisa tu WhatsApp" back="/entrar">
      <p>Te enviamos un código de 6 números{state.maskedPhone ? ` al ${state.maskedPhone}` : ''}.</p>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="code" label="Código" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          className="input text-center text-3xl font-bold tracking-[0.4em]" autoFocus
          value={code} error={error} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Verificando…' : 'Verificar'}</button>
      </form>
      <ResendButton phone={state.phone} initialWait={state.wait ?? 0} />
      <p className="text-center text-base">
        ¿Escribiste mal tu número?{' '}
        <Link to="/registro" className="inline-flex min-h-[48px] items-center font-semibold text-brand underline">Corrígelo aquí</Link>
      </p>
    </AuthShell>
  );
}
