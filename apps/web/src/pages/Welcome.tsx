import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { MarkedMessage } from '../components/Marked';
import { Logo } from '../components/ui';

const EXAMPLE = 'Me llegó esto: "Bancolombia: tu cuenta será bloqueada hoy. Entra a bancolombia-seguro.xyz y escribe tu clave dinámica." No es del banco, no entren.';

/** Bienvenida: a la izquierda qué es, a la derecha cómo se ve una publicación real de la red. */
export default function Welcome() {
  return (
    <div className="min-h-screen">
      <header className="bg-card shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <span className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><Logo size={36} /> La Segura</span>
          <Link to="/entrar" className="rounded-xl px-4 py-2.5 text-base font-semibold text-brand hover:bg-brand-soft">Entrar</Link>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-8 lg:grid-cols-2 lg:gap-16 lg:py-16">
        <div className="space-y-6">
          <h1 className="text-[2.2rem] font-bold leading-[1.1] tracking-tight lg:text-[3rem]">
            La red de vecinos que se avisan <span className="text-brand">las estafas</span>.
          </h1>
          <p className="text-lg text-muted lg:text-xl">
            Mira lo que les está llegando a otros en tu barrio, revisa si un mensaje es estafa y avisa a tu comunidad.
          </p>
          <ul className="space-y-3 text-base">
            {['Revisa un mensaje, enlace o captura con inteligencia artificial.', 'Consulta un número antes de pagar.', 'Arma tu reporte para denunciar.'].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="check" size={18} /></span>{t}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/registro" className="btn-primary sm:w-auto sm:px-8">Crear cuenta gratis</Link>
            <Link to="/entrar" className="btn-ghost sm:w-auto sm:px-8">Ya tengo cuenta</Link>
          </div>
        </div>
        <article className="card space-y-4" aria-label="Ejemplo de publicación">
          <header className="flex items-start gap-3">
            <Avatar name="Gloria" />
            <div className="flex-1">
              <p className="text-base font-semibold">Gloria</p>
              <p className="text-sm text-muted">Bosa, Bogotá · hace 2 h</p>
            </div>
            <span className="chip bg-warn-bg text-warn">Me intentaron estafar</span>
          </header>
          <MarkedMessage text={EXAMPLE} plain />
          <div className="flex gap-2 border-t border-line pt-3 text-base font-semibold text-muted">
            <span className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-soft py-3 text-brand"><Icon name="check" size={22} />A mí también · 23</span>
            <span className="flex flex-1 items-center justify-center gap-2 py-3"><Icon name="share" size={22} />Compartir</span>
          </div>
        </article>
      </main>
    </div>
  );
}
