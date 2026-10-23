import { markTraps } from '../lib/traps';

/** El mensaje con las trampas marcadas y, debajo, las señales como etiquetas (como los hashtags de una red social). */
export function MarkedMessage({ text, label, plain = false }: { text: string; label?: string; plain?: boolean }) {
  const { segments, traps } = markTraps(text);
  return (
    <figure className="space-y-2.5">
      {label && <figcaption className="text-sm font-semibold text-muted">{label}</figcaption>}
      <blockquote className={`whitespace-pre-wrap break-words ${plain ? 'text-[1.05rem] leading-relaxed' : 'quote'}`}>
        {segments.map((s, i) => (s.trap ? <mark key={i} className="trap" title={s.trap.label}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
      </blockquote>
      {traps.length > 0 && (
        <ul aria-label="Señales de estafa" className="flex flex-wrap gap-2">
          {traps.map((t) => (
            <li key={t.key} className="chip bg-warn-bg text-warn">{t.label}</li>
          ))}
        </ul>
      )}
    </figure>
  );
}
