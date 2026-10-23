import { useState } from 'react';
import { api, errMsg } from '../api/client';
import { FRAUD_TYPES, type Post } from '../api/types';
import { timeAgo } from '../lib/traps';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { MarkedMessage } from './Marked';

/** Una publicación del muro, con la forma de cualquier red social: quién, dónde, qué pasó y cómo reaccionar. */
export function PostCard({ post, onDeleted }: { post: Post; onDeleted: (id: number) => void }) {
  const [confirms, setConfirms] = useState(post.confirms);
  const [me, setMe] = useState(post.confirmedByMe);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shared, setShared] = useState(false);

  const act = async (fn: () => Promise<void>, after: () => void) => {
    setBusy(true);
    setError('');
    try { await fn(); after(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const toggle = () => act(
    () => (me ? api.unconfirmPost(post.id) : api.confirmPost(post.id)),
    () => { setConfirms((c) => c + (me ? -1 : 1)); setMe(!me); },
  );
  const remove = () => {
    if (window.confirm('¿Borrar tu publicación?')) void act(() => api.deletePost(post.id), () => onDeleted(post.id));
  };
  // Compartir con la familia (por WhatsApp, por ejemplo): el texto ya viene sin datos personales.
  const share = async () => {
    const text = `Ojo con esta estafa (La Segura): ${post.body}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setShared(true); }
    } catch { /* la persona canceló */ }
  };
  const lost = post.kind === 'estafaron';

  return (
    <article className="card space-y-4">
      <header className="flex items-start gap-3">
        {post.mine ? <Avatar name="Tú" /> : (
          // El muro es anónimo: un avatar genérico, igual para todos.
          <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="users" size={24} /></span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight">{post.author}</p>
          <p className="text-sm text-muted">{post.place} · {timeAgo(post.createdAt)}</p>
        </div>
      </header>
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <span className={`chip ${lost ? 'bg-[#c41e24] text-white' : 'bg-warn-bg text-warn'}`}><Icon name={lost ? 'stopSign' : 'alert'} size={16} />{lost ? 'Me estafaron' : 'Me intentaron estafar'}</span>
        {post.fraudType && <span className="text-brand">{FRAUD_TYPES[post.fraudType] ?? post.fraudType}</span>}
        {post.demo && <span className="chip bg-soft text-muted">Ejemplo</span>}
      </p>
      <MarkedMessage text={post.body} plain />
      {post.demo && <p className="sr-only">Publicación de ejemplo</p>}
      <div className="flex items-center gap-2 border-t border-line pt-3">
        {post.mine ? (
          <>
            <p className="flex min-h-[48px] flex-1 items-center gap-2 text-base text-muted"><Icon name="users" size={22} /> {confirms} vecinos dicen “a mí también”</p>
            <button type="button" onClick={remove} disabled={busy}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl px-3 text-base font-medium text-danger hover:bg-danger-bg">
              <Icon name="trash" size={20} /> Borrar
            </button>
          </>
        ) : (
          <>
            <button type="button" aria-pressed={me} onClick={toggle} disabled={busy}
              className={`inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl text-base font-semibold ${me ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-soft'}`}>
              <Icon name={me ? 'check' : 'users'} size={22} />A mí también · {confirms}
            </button>
            <button type="button" onClick={() => void share()}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl text-base font-semibold text-muted hover:bg-soft">
              <Icon name="share" size={22} />{shared ? 'Copiado' : 'Compartir'}
            </button>
          </>
        )}
      </div>
      {error && <p role="alert" className="field-error">{error}</p>}
    </article>
  );
}
