import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, formatWait } from '../api/client';
import type { Locality, Municipality } from '../api/types';
import { MunicipalityCombobox } from '../components/MunicipalityCombobox';
import { AuthShell, Field, FormError, PasswordField } from '../components/ui';

export const BOGOTA = '11001';

export interface RegisterValues {
  name: string; phone: string; password: string; municipality: Municipality | null; localityId: string;
}
export type RegisterErrors = Partial<Record<keyof RegisterValues, string>>;

export function validateRegister(v: RegisterValues): RegisterErrors {
  const e: RegisterErrors = {};
  if (v.name.trim().length < 2) e.name = 'Escribe tu nombre.';
  if (!/^3\d{9}$/.test(v.phone)) e.phone = 'Escribe tu celular de 10 números, empieza por 3 (ej. 3001234567).';
  if (v.password.length < 8) e.password = 'La contraseña debe tener mínimo 8 caracteres.';
  if (!v.municipality) e.municipality = 'Busca y elige tu municipio de la lista.';
  else if (v.municipality.code === BOGOTA && !v.localityId) e.localityId = 'Elige tu localidad de Bogotá.';
  return e;
}

export default function Register() {
  const nav = useNavigate();
  const [v, setV] = useState<RegisterValues>(() => {
    const empty: RegisterValues = { name: '', phone: '', password: '', municipality: null, localityId: '' };
    try {
      const d = JSON.parse(sessionStorage.getItem('ps_register_draft') ?? 'null') as Partial<RegisterValues> | null;
      return d ? { ...empty, name: d.name ?? '', municipality: d.municipality ?? null, localityId: d.localityId ?? '' } : empty;
    } catch { return empty; }
  });
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const isBogota = v.municipality?.code === BOGOTA;

  useEffect(() => {
    if (!isBogota || localities.length) return;
    api.localities().then((r) => setLocalities(r.items)).catch(() => setFormError('No pudimos cargar las localidades. Intenta de nuevo.'));
  }, [isBogota, localities.length]);

  const set = <K extends keyof RegisterValues>(k: K, val: RegisterValues[K]) => setV((p) => ({ ...p, [k]: val }));

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError('');
    const errs = validateRegister(v);
    setErrors(errs);
    if (Object.keys(errs).length || !v.municipality) return;
    setBusy(true);
    try {
      const r = await api.register({
        name: v.name.trim(), phone: v.phone, password: v.password,
        municipalityCode: v.municipality.code,
        ...(isBogota ? { localityId: Number(v.localityId) } : {}),
      });
      // Se guarda el borrador (sin la contraseña) por si la persona escribió mal su número y quiere corregirlo.
      try { sessionStorage.setItem('ps_register_draft', JSON.stringify({ name: v.name, municipality: v.municipality, localityId: v.localityId })); } catch { /* sin storage */ }
      nav('/verificar', { state: { phone: v.phone, maskedPhone: r.phone, wait: 60 } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setFormError(`${e.message}. Podrás pedir otro en ${formatWait(e.retryAfterSec ?? 60)}.`);
      } else if (e instanceof ApiError && e.status === 409) {
        setFormError('Ese celular ya tiene cuenta. Prueba entrando.');
      } else {
        setFormError(e instanceof ApiError ? e.message : 'No pudimos crear tu cuenta.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Crea tu cuenta">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="name" label="Tu nombre" autoComplete="name" value={v.name} error={errors.name}
          onChange={(e) => set('name', e.target.value)} />
        <Field id="phone" label="Tu celular" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10}
          value={v.phone} error={errors.phone} hint="Te enviaremos un código por WhatsApp."
          onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))} />
        <PasswordField id="password" label="Contraseña" autoComplete="new-password" value={v.password}
          error={errors.password} hint="Mínimo 8 caracteres." onChange={(e) => set('password', e.target.value)} />
        <MunicipalityCombobox value={v.municipality} error={errors.municipality}
          onChange={(m) => { set('municipality', m); set('localityId', ''); }} />
        {isBogota && (
          <div>
            <label htmlFor="locality" className="label">Localidad de Bogotá</label>
            <select id="locality" className="input" value={v.localityId} onChange={(e) => set('localityId', e.target.value)}
              aria-invalid={errors.localityId ? true : undefined} aria-describedby={errors.localityId ? 'locality-err' : undefined}>
              <option value="">Elige tu localidad</option>
              {localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {errors.localityId && <p id="locality-err" role="alert" className="field-error">{errors.localityId}</p>}
          </div>
        )}
        {formError && <FormError>{formError}</FormError>}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creando…' : 'Crear cuenta'}</button>
        <p className="text-center text-sm">¿Ya tienes cuenta? <Link to="/entrar" className="font-bold text-brand underline">Entra aquí</Link></p>
      </form>
    </AuthShell>
  );
}
