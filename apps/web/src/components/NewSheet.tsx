import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

const OPTIONS: Array<{ to: string; icon: IconName; title: string; text: string; tone: string }> = [
  { to: '/app/revisar', icon: 'search', title: 'Habla con La Segura', text: 'Pega el mensaje, pregúntale o mándale un audio o una captura.', tone: 'bg-brand-soft text-brand' },
  { to: '/app/llamar', icon: 'phone', title: 'Llamar a La Segura', text: 'Cuéntale hablando y te responde con voz.', tone: 'bg-ok-bg text-ok' },
  { to: '/app?contar=1', icon: 'pen', title: 'Contar lo que me pasó', text: 'Publica en el muro para avisar a tus vecinos.', tone: 'bg-warn-bg text-warn' },
];

/** Botón "+": las tres cosas que se pueden hacer, grandes y con explicación. Se cierra con Esc o tocando afuera. */
export function NewSheet({ onClose }: { onClose: () => void }) {
  const first = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-3xl bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 id="new-title" className="text-xl font-semibold">¿Qué quieres hacer?</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-12 w-12 place-items-center rounded-full bg-soft hover:bg-line">
            <Icon name="x" size={24} />
          </button>
        </div>
        {OPTIONS.map((o, i) => (
          <Link key={o.to} ref={i === 0 ? first : undefined} to={o.to} onClick={onClose}
            className="flex min-h-[84px] items-center gap-4 rounded-2xl border border-line p-4 hover:bg-soft">
            <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${o.tone}`}><Icon name={o.icon} size={28} /></span>
            <span>
              <span className="block text-lg font-semibold">{o.title}</span>
              <span className="block text-base text-muted">{o.text}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
