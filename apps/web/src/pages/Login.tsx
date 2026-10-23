import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, formatWait } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthShell, Field, FormError, PasswordField } from '../components/ui';

export default function Login() {
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/app';
  const { setUser } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ phone?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError('');
    const errs = {
      phone: /^3\d{9}$/.test(phone) ? undefined : 'Escribe tu celular de 10 números (empieza por 3).',
      password: password ? undefined : 'Escribe tu contraseña.',
    };
    setErrors(errs);
    if (errs.phone || errs.password) return;
    setBusy(true);
    try {
      setUser(await api.login(phone, password));
      nav(from, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        nav('/verificar', { state: { phone, wait: 0 } }); // sin verificar: pedir/reenviar código
      } else if (e instanceof ApiError && e.status === 429) {
        setFormError(`Demasiados intentos. Espera ${formatWait(e.retryAfterSec ?? 60)} y prueba de nuevo.`);
      } else if (e instanceof ApiError && e.status === 401) {
        setFormError('Celular o contraseña incorrectos.');
      } else {
        setFormError(e instanceof ApiError ? e.message : 'No pudimos entrar.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Qué bueno verte de nuevo">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="phone" label="Tu celular" type="tel" inputMode="numeric" autoComplete="username" maxLength={10}
          value={phone} error={errors.phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} />
        <PasswordField id="password" label="Contraseña" autoComplete="current-password" value={password}
          error={errors.password} onChange={(e) => setPassword(e.target.value)} />
        {formError && <FormError>{formError}</FormError>}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="text-center"><Link to="/recuperar" className="inline-flex min-h-[48px] items-center font-bold text-brand underline">¿Olvidaste tu contraseña?</Link></p>
        <p className="text-center">¿No tienes cuenta? <Link to="/registro" className="font-bold text-brand underline">Crea una</Link></p>
      </form>
    </AuthShell>
  );
}
