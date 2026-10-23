import { useCallback, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { Icon, type IconName } from './Icon';
import { DonateSheet } from './DonateSheet';
import { NewSheet } from './NewSheet';
import { Logo } from './ui';

type Tab = { to: string; label: string; icon: IconName; end: boolean };
const LEFT: Tab[] = [
  { to: '/app', label: 'Inicio', icon: 'home', end: true },
  { to: '/app/llamar', label: 'Llamar', icon: 'phone', end: false },
];
const RIGHT: Tab[] = [
  { to: '/app/mapa', label: 'Mapa', icon: 'pin', end: false },
  { to: '/app/perfil', label: 'Yo', icon: 'user', end: false },
];

/** Buscador de la barra superior: consulta si un celular o enlace ya fue reportado. */
function TopSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (q.trim()) nav(`/app/consulta?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <form role="search" onSubmit={submit} className="relative hidden w-full max-w-sm md:block">
      <label htmlFor="top-q" className="sr-only">Consultar un celular o enlace</label>
      <Icon name="search" size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
      <input id="top-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Consulta un celular o enlace"
        className="min-h-[48px] w-full rounded-full bg-soft pl-11 pr-4 text-base placeholder:text-muted focus:bg-card focus:outline-none focus:ring-2 focus:ring-brand" />
    </form>
  );
}

const bottomTab = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[64px] flex-col items-center justify-center gap-1 text-sm font-medium ${isActive ? 'text-brand' : 'text-muted'}`;

/** Layout autenticado: barra superior de red social y, en el celular, menú inferior con el botón "+" al centro. */
export function AppLayout() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  const [sheet, setSheet] = useState(false);
  const [donate, setDonate] = useState(false);
  const closeDonate = useCallback(() => setDonate(false), []);
  const close = useCallback(() => setSheet(false), []);
  if (loading) return <p className="p-8 text-center text-lg font-semibold" role="status">Cargando…</p>;
  if (!user) return <Navigate to="/entrar" replace state={{ from: loc.pathname }} />;
  const wide = loc.pathname === '/app' || loc.pathname === '/app/mapa';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-4 px-4">
          <Link to="/app" className="flex shrink-0 items-center gap-2.5 text-xl font-bold tracking-tight">
            <Logo size={36} /> <span className="hidden sm:inline">La Segura</span>
          </Link>
          <TopSearch />
          <nav aria-label="Principal" className="mx-auto hidden items-center gap-1 lg:flex">
            {[...LEFT, RIGHT[0]!].map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }: { isActive: boolean }) =>
                  `flex min-h-[48px] items-center gap-2 rounded-xl px-4 text-base font-medium ${isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-soft'}`}>
                <Icon name={t.icon} size={22} />{t.label}
              </NavLink>
            ))}
            <button type="button" onClick={() => setSheet(true)}
              className="ml-2 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-brand px-5 text-base font-semibold text-brand-ink hover:brightness-110">
              <Icon name="plus" size={22} /> Nuevo
            </button>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {/* Donar: resaltado y siempre visible desde que la persona entra. */}
            <button type="button" onClick={() => setDonate(true)} aria-haspopup="dialog"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-sun px-3.5 text-base font-semibold text-[#1c1e21] shadow-sm hover:brightness-95 sm:px-4">
              <Icon name="heart" size={20} /> Donar
            </button>
            <Link to="/app/creditos" aria-label={`Tienes ${user.credits} créditos. Ver mis créditos`}
              className="flex min-h-[44px] items-center gap-1.5 rounded-full bg-soft px-3.5 text-base font-semibold">
              <Icon name="coins" size={20} /> {user.credits}
            </Link>
            <Link to="/app/perfil" className="flex min-h-[44px] items-center gap-2 rounded-full pr-1 hover:bg-soft sm:pr-3" aria-label="Mi perfil">
              <Avatar name={user.name} size={40} />
              <span className="hidden text-base font-medium lg:inline">{user.name.split(' ')[0]}</span>
            </Link>
          </div>
        </div>
      </header>

      <main className={`mx-auto px-4 pb-32 pt-5 lg:pb-12 ${wide ? 'max-w-[1280px]' : 'max-w-2xl'}`}><Outlet /></main>

      <nav aria-label="Menú" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-xl items-end">
          {LEFT.map((t) => (
            <li key={t.to} className="flex-1"><NavLink to={t.to} end={t.end} className={bottomTab}><Icon name={t.icon} size={26} />{t.label}</NavLink></li>
          ))}
          <li className="flex-1">
            <button type="button" onClick={() => setSheet(true)} aria-haspopup="dialog"
              className="flex min-h-[64px] w-full flex-col items-center justify-center gap-1 text-sm font-semibold text-brand">
              <span className="-mt-7 grid h-14 w-14 place-items-center rounded-full bg-brand text-brand-ink shadow-[0_6px_16px_rgb(28_93_125/0.4)] ring-4 ring-card">
                <Icon name="plus" size={30} />
              </span>
              Nuevo
            </button>
          </li>
          {RIGHT.map((t) => (
            <li key={t.to} className="flex-1"><NavLink to={t.to} end={t.end} className={bottomTab}><Icon name={t.icon} size={26} />{t.label}</NavLink></li>
          ))}
        </ul>
      </nav>
      {sheet && <NewSheet onClose={close} />}
      {donate && <DonateSheet onClose={closeDonate} />}
    </div>
  );
}
