import { useState, type ReactNode, type InputHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

/** Logo de La Segura (lupa con chulo dentro de un globo de chat). Decorativo: el nombre siempre va al lado en texto. */
export function Logo({ size = 40 }: { size?: number }) {
  return <img src="/logo.png" width={size} height={size} alt="" aria-hidden="true" className="shrink-0 dark:rounded-lg dark:bg-white dark:p-0.5" />;
}

export function AuthShell({ title, children, back = '/' }: { title: string; children: ReactNode; back?: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 px-4 py-6 sm:justify-center">
      <Link to={back} className="flex min-h-[52px] items-center justify-center gap-3 text-xl font-bold tracking-tight">
        <Logo size={40} /> <span>La Segura</span>
      </Link>
      <div className="card space-y-5 sm:p-7">
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

export function Field({ id, label, error, hint, ...rest }: FieldProps) {
  const describedBy = [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-base text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="field-error">{error}</p>}
    </div>
  );
}

export function PasswordField({ id, label, error, hint, ...rest }: FieldProps) {
  const [show, setShow] = useState(false);
  const describedBy = [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          className="input"
          type={show ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
          className="min-h-[58px] min-w-[96px] rounded-2xl border-2 border-line bg-card px-3 text-base font-bold"
        >
          {show ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-base text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="field-error">{error}</p>}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2.5 rounded-2xl bg-danger-bg p-4 text-base font-bold text-danger">
      <Icon name="alert" className="mt-0.5" />
      <span>{children}</span>
    </p>
  );
}
