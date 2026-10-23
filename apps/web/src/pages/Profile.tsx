import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api/client';
import type { Post } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { EmptyArt } from '../components/EmptyArt';
import { Icon, type IconName } from '../components/Icon';
import { PostCard } from '../components/PostCard';
import { FormError } from '../components/ui';

const ITEMS: Array<{ to: string; icon: IconName; title: string }> = [
  { to: '/app/consulta', icon: 'shieldCheck', title: 'Consultar antes de pagar' },
  { to: '/app/mapa', icon: 'pin', title: 'Mapa de estafas' },
  { to: '/app/reportes', icon: 'file', title: 'Mis reportes' },
  { to: '/app/creditos', icon: 'coins', title: 'Mis créditos' },
];

/** Mi perfil, como en cualquier red social: quién soy, lo que he publicado y lo que les ha servido a mis vecinos. */
export default function Profile() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.myPosts()
      .then((p) => { setPosts(p.items); if (p.area) setArea(p.area.replace(/,?\s*D\.?\s*C\.?$/i, '').toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())); })
      .catch((e) => setError(errMsg(e)));
  }, []);

  if (!user) return null;
  const helped = (posts ?? []).reduce((n, p) => n + p.confirms, 0);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl bg-card shadow-sm">
        <div className="h-24 bg-gradient-to-br from-[#1c5d7d] via-[#1f7491] to-[#2cbbcb]" aria-hidden="true" />
        <div className="-mt-12 space-y-4 px-5 pb-5">
          <span className="inline-block rounded-full ring-4 ring-card"><Avatar name={user.name} size={88} /></span>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">{user.name}</h1>
            <p className="text-base text-muted">
              {area ? `${area} · ` : ''}{user.phone.slice(-10).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')}
            </p>
          </div>
          <dl className="grid grid-cols-3 rounded-2xl bg-soft py-3 text-center">
            <div className="flex flex-col-reverse justify-end"><dt className="text-xs text-muted sm:text-sm">Publicaciones</dt><dd className="text-xl font-semibold">{posts?.length ?? '–'}</dd></div>
            <div className="flex flex-col-reverse justify-end"><dt className="text-xs text-muted sm:text-sm">Vecinos alertados</dt><dd className="text-xl font-semibold">{posts ? helped : '–'}</dd></div>
            <div className="flex flex-col-reverse justify-end"><dt className="text-xs text-muted sm:text-sm">Créditos</dt><dd className="text-xl font-semibold">{user.credits}</dd></div>
          </dl>
        </div>
      </section>

      <nav className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-4" aria-label="Más opciones">
        {ITEMS.map((i) => (
          <Link key={i.to} to={i.to} className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl px-2 text-center text-sm font-medium hover:bg-soft">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={i.icon} size={22} /></span>
            {i.title}
          </Link>
        ))}
      </nav>

      <h2 className="px-1 text-lg font-semibold">Mis publicaciones</h2>
      {error && <FormError>{error}</FormError>}
      {!posts && !error && <p role="status" className="text-center text-lg font-semibold">Cargando…</p>}
      {posts?.length === 0 && (
        <div className="card flex flex-col items-center gap-3 py-10 text-center">
          <EmptyArt />
          <p className="text-lg font-semibold">Todavía no has publicado nada</p>
          <p className="text-base text-muted">Cuando te llegue algo raro, cuéntalo y cuida a tus vecinos.</p>
          <Link to="/app?contar=1" className="btn-primary w-auto px-8">Contar lo que me pasó</Link>
        </div>
      )}
      {posts?.map((p) => <PostCard key={p.id} post={p} onDeleted={(id) => setPosts((c) => (c ?? []).filter((x) => x.id !== id))} />)}
      <button type="button" className="btn-ghost" onClick={async () => { await logout(); nav('/', { replace: true }); }}>
        Cerrar sesión
      </button>
    </div>
  );
}
