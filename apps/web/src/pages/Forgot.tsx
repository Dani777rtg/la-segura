import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, formatWait } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthShell, Field, FormError, PasswordField } from '../components/ui';

/** Recuperar contraseña: 1) celular, 2) código de WhatsApp + contraseña nueva. */
export default function Forgot() {
  const nav = useNavigate();
  const { setUser } = useAuth();
  const [step, setStep] = useState<'phone' | 'reset'>('phone');
  const [phone, setPhone] = useState('');
  const [masked, setMasked] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ phone?: string; code?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown, fallback: string) =>
    setFormError(e instanceof ApiError ? (e.status === 429 && e.retryAfterSec ? `${e.message} (${formatWait(e.retryAfterSec)})` : e.message) : fallback);

  const sendCode = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError('');
    if (!/^3\d{9}$/.test(phone)) { setErrors({ phone: 'Escribe tu celular de 10 números (empieza por 3).' }); return; }
    setErrors({});
    setBusy(true);
    try {
      const r = await api.forgotPassword(phone);
      setMasked(r.phone);
      setStep('reset');
    } catch (e) {
      fail(e, 'No pudimos enviar el código. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError('');
    const errs = {
      code: /^\d{6}$/.test(code) ? undefined : 'Escribe los 6 números del código.',
      password: password.length >= 8 ? undefined : 'La contraseña nueva debe tener mínimo 8 caracteres.',
    };
    setErrors(errs);
    if (errs.code || errs.password) return;
    setBusy(true);
    try {
      setUser(await api.resetPassword(phone, code, password));
      nav('/app', { replace: true });
    } catch (e) {
      fail(e, 'No pudimos cambiar la contraseña.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={step === 'phone' ? 'Recupera tu contraseña' : 'Revisa tu WhatsApp'} back="/entrar">
      {step === 'phone' ? (
        <form onSubmit={sendCode} noValidate className="space-y-4">
          <p>Escribe tu celular y te mandamos un código por WhatsApp para que elijas una contraseña nueva.</p>
          <Field id="phone" label="Tu celular" type="tel" inputMode="numeric" autoComplete="username" maxLength={10}
            value={phone} error={errors.phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} />
          {formError && <FormError>{formError}</FormError>}
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviarme el código'}</button>
          <p className="text-center"><Link to="/entrar" className="inline-flex min-h-[48px] items-center font-bold text-brand underline">Volver a entrar</Link></p>
        </form>
      ) : (
        <form onSubmit={reset} noValidate className="space-y-4">
          <p>Si ese celular tiene cuenta, te enviamos un código de 6 números{masked ? ` al ${masked}` : ''}. Vale por 10 minutos.</p>
          <Field id="code" label="Código" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
            className="input text-center text-3xl font-bold tracking-[0.4em]"
            value={code} error={errors.code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <PasswordField id="newpass" label="Contraseña nueva" autoComplete="new-password" hint="Mínimo 8 caracteres."
            value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
          {formError && <FormError>{formError}</FormError>}
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Cambiar contraseña y entrar'}</button>
        </form>
      )}
    </AuthShell>
  );
}
