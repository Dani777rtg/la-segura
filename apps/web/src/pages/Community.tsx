import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api/client';
import type { Post } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { Icon, type IconName } from '../components/Icon';
import { FormError } from '../components/ui';
import { EmptyArt } from '../components/EmptyArt';
import { PostCard } from '../components/PostCard';
import { PostForm } from '../components/PostForm';

const SHORTCUTS: Array<{ to: string; icon: IconName; label: string }> = [
  { to: '/app/revisar', icon: 'search', label: 'Revisar un mensaje' },
  { to: '/app/consulta', icon: 'shieldCheck', label: 'Consultar antes de pagar' },
  { to: '/app/mapa', icon: 'pin', label: 'Mapa de estafas' },
  { to: '/app/reportes', icon: 'file', label: 'Mis reportes' },
];

const TIPS = [
  'Ningún banco te pide la clave ni el código por mensaje.',
  'Un comprobante no prueba que la plata llegó: mira tu cuenta.',
  'Si te apuran, desconfía. Cuelga y llama tú al número oficial.',
];

// DIVIPOLA trae "BOGOTÁ, D.C." o "MEDELLÍN": se muestra "Bogotá" o "Medellín".
const title = (s: string) => s.replace(/,?\s*D\.?\s*C\.?$/i, '').toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());

function QuickLookup() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const submit = (ev: FormEvent) => { ev.preventDefault(); if (q.trim()) nav(`/app/consulta?q=${encodeURIComponent(q.trim())}`); };
  return (
    <section className="card space-y-3" aria-labelledby="ql-title">
      <h2 id="ql-title" className="text-lg font-semibold">¿Vas a pagar? Consulta primero</h2>
      <p className="text-base text-muted">Mira si tus vecinos ya reportaron ese celular o enlace.</p>
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="ql" className="sr-only">Celular o enlace</label>
        <input id="ql" className="input" placeholder="Ej: 3001234567" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn-primary">Consultar gratis</button>
      </form>
    </section>
  );
}

/** Inicio: muro de la comunidad con el diseño de una red social (3 columnas en computador, 1 en celular). */
export default function Community() {
  const { user } = useAuth();
  const [items, setItems] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [params, setParams] = useSearchParams();
  const [writing, setWriting] = useState(() => params.get('contar') === '1');
  // "Contar lo que me pasó" desde el botón + llega con ?contar=1.
  useEffect(() => { if (params.get('contar') === '1') { setWriting(true); setParams({}, { replace: true }); } }, [params, setParams]);
  // Vuelta desde Mercado Pago después de donar.
  const [donation] = useState(() => params.get('donacion'));

  const load = useCallback(async (before?: string | null) => {
    setLoading(true);
    setError('');
    try {
      const p = await api.posts(before);
      setItems((cur) => (before ? [...cur, ...p.items] : p.items));
      setCursor(p.nextCursor);
      // DIVIPOLA trae los municipios en mayúsculas: "MEDELLÍN" se muestra "Medellín".
      if (p.area) setArea(title(p.area));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const firstName = user?.name.split(' ')[0] ?? '';
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)_300px]">
      {/* Columna izquierda (solo computador): tu perfil y atajos */}
      <aside className="hidden space-y-5 lg:block" aria-label="Tu perfil y atajos">
        {user && (
          <section className="card flex flex-col items-center gap-2 text-center">
            <Avatar name={user.name} size={72} />
            <p className="text-lg font-semibold">{user.name}</p>
            <p className="text-base text-muted">{area ?? 'Tu barrio'}</p>
            <div className="mt-2 grid w-full grid-cols-2 rounded-xl bg-soft py-3">
              <div><p className="text-xl font-semibold">{user.credits}</p><p className="text-sm text-muted">Créditos</p></div>
              <div><p className="text-xl font-semibold">{items.filter((p) => p.mine).length}</p><p className="text-sm text-muted">Avisos tuyos</p></div>
            </div>
            <Link to="/app/perfil" className="btn-primary mt-2">Mi perfil</Link>
          </section>
        )}
        <nav className="card space-y-1" aria-label="Atajos">
          <h2 className="mb-2 text-lg font-semibold">Atajos</h2>
          {SHORTCUTS.map((s) => (
            <Link key={s.to} to={s.to} className="flex min-h-[52px] items-center gap-3 rounded-xl px-2 text-base font-medium hover:bg-soft">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={s.icon} size={22} /></span>
              {s.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Centro: publicar y el muro */}
      <div className="min-w-0 space-y-5">
        {donation && (
          <p role="status" className={`card flex items-start gap-3 text-base ${donation === 'failure' ? 'text-danger' : ''}`}>
            <Icon name={donation === 'failure' ? 'alert' : 'heart'} size={24} className={donation === 'failure' ? '' : 'text-[#9a5b00]'} />
            {donation === 'success' ? '¡Gracias por tu donación! Nos ayuda a cuidar a más familias.'
              : donation === 'pending' ? 'Tu donación está en proceso. Cuando Mercado Pago la confirme, quedará registrada. ¡Gracias!'
              : 'No se pudo completar la donación. No te cobramos; puedes intentarlo de nuevo.'}
          </p>
        )}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1c5d7d] via-[#1f7491] to-[#2cbbcb] p-6 text-white shadow-md">
          <span aria-hidden="true" className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10" />
          <span aria-hidden="true" className="absolute -bottom-16 right-24 h-36 w-36 rounded-full bg-white/10" />
          <div className="relative space-y-4">
            <div className="space-y-1">
              <p className="text-base text-white/85">Hola, {firstName}</p>
              <h1 className="text-2xl font-semibold leading-tight sm:text-[1.7rem]">Posibles estafas que tus vecinos han reportado{area ? ` en ${area}` : ''}</h1>
              <p className="text-base text-white/85">Lo resaltado en amarillo es la trampa. Si te llega algo parecido, no respondas.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/app/llamar" className="inline-flex min-h-[52px] items-center gap-2 rounded-full bg-white px-5 text-base font-semibold text-[#1c5d7d] hover:bg-white/90">
                <Icon name="phone" size={22} /> Llamar a La Segura
              </Link>
              <Link to="/app/revisar" className="inline-flex min-h-[52px] items-center gap-2 rounded-full bg-white/15 px-5 text-base font-semibold text-white ring-1 ring-white/40 hover:bg-white/25">
                <Icon name="search" size={22} /> Revisar mensaje
              </Link>
            </div>
          </div>
        </section>

        <section className="card space-y-4" aria-label="Publicar">
          <div className="flex items-center gap-3">
            {user && <Avatar name={user.name} size={44} />}
            <button type="button" onClick={() => setWriting(true)}
              className="min-h-[52px] flex-1 rounded-full bg-soft px-5 text-left text-base text-muted hover:bg-line">
              ¿Te pasó algo, {firstName}? Cuéntalo
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1 border-t border-line pt-3">
            <Link to="/app/revisar" className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl text-[0.9rem] font-medium text-muted hover:bg-soft sm:gap-2 sm:text-base">
              <Icon name="search" size={22} className="text-brand" /> Revisar
            </Link>
            <Link to="/app/llamar" className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl text-[0.9rem] font-medium text-muted hover:bg-soft sm:gap-2 sm:text-base">
              <Icon name="phone" size={22} className="text-ok" /> Llamar
            </Link>
            <button type="button" onClick={() => setWriting(true)} className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl text-[0.9rem] font-medium text-muted hover:bg-soft sm:gap-2 sm:text-base">
              <Icon name="pen" size={22} className="text-warn" /> Contar
            </button>
          </div>
          {writing && <PostForm onCancel={() => setWriting(false)} onDone={() => { setWriting(false); void load(); }} />}
        </section>

        <h2 className="px-1 text-lg font-semibold">Primero lo de {area ?? 'tu barrio'}</h2>

        {error && <FormError>{error}</FormError>}
        {items.map((p, i) => (
          <div key={p.id} className="space-y-5">
            {i > 0 && !p.near && items[i - 1]!.near && (
              <p className="pt-2 text-center text-base font-semibold text-muted">Más lejos: tu departamento y el resto del país</p>
            )}
            {i === 0 && !p.near && area && (
              <p className="text-center text-base text-muted">En el último mes no hay historias de {area}. Esto es lo de cerca.</p>
            )}
            <PostCard post={p} onDeleted={(id) => setItems((c) => c.filter((x) => x.id !== id))} />
          </div>
        ))}
        {!loading && !error && items.length === 0 && (
          <div className="card flex flex-col items-center gap-3 py-10 text-center">
            <EmptyArt />
            <p className="text-lg font-semibold">Aún no hay historias</p>
            <p className="text-base text-muted">Sé el primero en contar lo que te pasó y cuida a tus vecinos.</p>
            <button type="button" className="btn-primary w-auto px-8" onClick={() => setWriting(true)}>Contar lo que me pasó</button>
          </div>
        )}
        {loading && <p role="status" className="py-4 text-center text-lg font-semibold">Cargando…</p>}
        {!loading && cursor && <button type="button" className="btn-ghost" onClick={() => void load(cursor)}>Ver más historias</button>}
      </div>

      {/* Columna derecha (solo computador): consulta rápida y consejos */}
      <aside className="hidden space-y-5 lg:block" aria-label="Consulta y consejos">
        <QuickLookup />
        <section className="card space-y-3" aria-labelledby="tips-title">
          <h2 id="tips-title" className="text-lg font-semibold">Para no caer</h2>
          <ul className="space-y-3">
            {TIPS.map((t) => (
              <li key={t} className="flex gap-3 text-base">
                <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ok-bg text-ok"><Icon name="check" size={16} /></span>
                {t}
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
