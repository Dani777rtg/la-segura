import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, ApiError, formatWait } from '../api/client';
import type { AssistantReply } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { ReportSheet } from '../components/ReportSheet';
import { RiskCard } from '../components/RiskCard';
import { FormError, Logo } from '../components/ui';
import { takeSharedText } from '../hooks/sharedText';
import { resizeImage } from '../hooks/resizeImage';
import { MAX_REC_SEC, useRecorder } from '../hooks/useRecorder';

type Msg = {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  channel?: string;
  analysis?: AssistantReply['analysis'];
  checked?: string; // el texto que se revisó (para subrayar las trampas)
};

const SUGGESTIONS = ['Me llegó un mensaje raro', '¿Qué es el phishing?', '¿En qué me puedes ayudar?', 'Me robaron, ¿qué hago?'];
const CHANNEL: Record<string, string> = { whatsapp: 'por WhatsApp', voice: 'en llamada' };
let seq = 0;
const k = () => `m${++seq}`;

/** Chat con La Segura: el mismo asistente y la misma conversación que WhatsApp y las llamadas. */
export default function Chat() {
  const { user, setUser } = useAuth();
  const sharedState = (useLocation().state as { text?: string } | null)?.text;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [noCredits, setNoCredits] = useState(false);
  const [reportCase, setReportCase] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const refreshCredits = () => { api.me().then(setUser).catch(() => undefined); };

  /** Envía algo al asistente y pinta la respuesta (texto y, si revisó algo, la tarjeta del resultado). */
  const ask = async (label: string, mine: Msg | null, fn: () => Promise<AssistantReply>) => {
    setError('');
    setNoCredits(false);
    if (mine) setMsgs((m) => [...m, mine]);
    setBusy(label);
    try {
      const r = await fn();
      const userText = r.transcript ? `🎤 ${r.transcript}` : r.extractedText ? '📷 Captura de pantalla' : null;
      setMsgs((m) => {
        const next = [...m];
        if (userText) next.push({ key: k(), role: 'user', text: userText });
        next.push({
          key: k(), role: 'assistant', text: r.reply, analysis: r.analysis,
          checked: r.analysis ? (r.extractedText ?? r.transcript ?? mine?.text) : undefined,
        });
        return next;
      });
      if (r.analysis && user) setUser({ ...user, credits: r.analysis.creditsLeft });
      if (r.action === 'report' && r.caseId) setReportCase(r.caseId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setNoCredits(true);
      else if (e instanceof ApiError && e.status === 429) setError(e.retryAfterSec ? `${e.message} (${formatWait(e.retryAfterSec)})` : e.message);
      else setError(e instanceof ApiError ? e.message : 'No pudimos enviar tu mensaje. Intenta de nuevo.');
    } finally {
      setBusy('');
    }
  };

  const send = (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    setText('');
    void ask('La Segura está escribiendo…', { key: k(), role: 'user', text: t }, () => api.assistantMessage(t));
  };

  const rec = useRecorder((blob) => { void ask('Escuchando tu audio…', null, () => api.assistantAudio(blob)); });

  const pickImage = (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    void ask('Leyendo la captura…', null, async () => {
      let blob: Blob;
      try { blob = await resizeImage(f); } catch { throw new ApiError(400, 'bad_image', 'No pudimos abrir esa imagen. Prueba con otra captura.'); }
      return api.assistantImage(blob);
    });
  };

  // Al entrar: la conversación de siempre (también lo hablado por WhatsApp y en llamadas). Si llegó algo compartido
  // desde otra app (un SMS), se manda solo.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.assistantHistory()
      .then((h) => setMsgs(h.items.map((i) => ({ key: `h${i.id}`, role: i.role, text: i.content, channel: i.channel }))))
      .catch(() => undefined)
      .finally(() => {
        const shared = sharedState ?? takeSharedText();
        if (shared.trim().length >= 3) send(shared);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  const submit = (ev: FormEvent) => { ev.preventDefault(); send(text); };
  const onKey = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    // En computador, Enter envía y Shift+Enter hace salto de línea. En el celular, el botón Enviar.
    if (ev.key === 'Enter' && !ev.shiftKey && window.matchMedia('(pointer: fine)').matches) { ev.preventDefault(); send(text); }
  };
  const working = !!busy || rec.recording;

  return (
    <div className="flex min-h-[calc(100dvh-12rem)] flex-col lg:min-h-[calc(100dvh-8rem)]">
      <div className="flex items-center gap-3 pb-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white shadow-sm ring-1 ring-line"><Logo size={34} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">Habla con La Segura</h1>
          <p className="text-sm text-muted">Pega un mensaje, pregúntale lo que quieras sobre estafas o mándale un audio.</p>
        </div>
        <Link to="/app/llamar" className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-ok-bg px-4 text-base font-semibold text-ok" aria-label="Llamar a La Segura">
          <Icon name="phone" size={20} /><span className="hidden sm:inline">Llamar</span>
        </Link>
      </div>

      <div role="log" aria-live="polite" aria-label="Conversación" className="flex-1 space-y-3 pb-4">
        {msgs.length === 0 && !busy && (
          <div className="flex gap-2">
            <span className="mt-1 hidden sm:block"><Logo size={28} /></span>
            <div className="card max-w-[85%] space-y-3">
              <p className="text-base">¡Hola{user ? `, ${user.name.split(' ')[0]}` : ''}! Soy La Segura. Pégame el mensaje, enlace o número que te llegó y te digo si parece una estafa. También puedes preguntarme lo que quieras sobre cómo cuidarte.</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-full bg-brand-soft px-4 py-2 text-base font-medium text-brand hover:brightness-95">{s}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        {msgs.map((m) => (m.role === 'user' ? (
          <div key={m.key} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-3 text-base text-brand-ink">
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
              {m.channel && CHANNEL[m.channel] && <p className="mt-1 text-xs text-brand-ink/75">{CHANNEL[m.channel]}</p>}
            </div>
          </div>
        ) : (
          <div key={m.key} className="space-y-3">
            <div className="flex gap-2">
              <span className="mt-1 hidden sm:block"><Logo size={28} /></span>
              <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-card px-4 py-3 text-base shadow-sm">
                <p className="whitespace-pre-wrap break-words">{m.text.replace(/\*/g, '')}</p>
                {m.channel && CHANNEL[m.channel] && <p className="mt-1 text-xs text-muted">{CHANNEL[m.channel]}</p>}
              </div>
            </div>
            {m.analysis && <div className="card sm:ml-9"><RiskCard r={m.analysis} message={m.checked} /></div>}
          </div>
        )))}
        {busy && <p role="status" className="flex items-center gap-2 pl-1 text-base text-muted"><span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" />{busy}</p>}
        {error && <FormError>{error}</FormError>}
        {noCredits && (
          <div className="card space-y-3" role="alert">
            <p className="text-lg font-semibold">Se te acabaron los créditos.</p>
            <Link to="/app/creditos" className="btn-primary">Recargar créditos</Link>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-1 rounded-3xl bg-card p-2 shadow-[0_4px_20px_rgb(0_0_0/0.1)] lg:bottom-4">
        {rec.recording ? (
          <button type="button" onClick={rec.stop}
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-danger-bg text-base font-semibold text-danger">
            <span aria-hidden="true" className="h-3 w-3 animate-pulse rounded-full bg-danger" />
            Escuchando… toca para enviar · <span role="timer">{formatWait(rec.seconds)}</span> / {formatWait(MAX_REC_SEC)}
          </button>
        ) : (
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={working} aria-label="Enviar una captura"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-muted hover:bg-soft disabled:opacity-50">
              <Icon name="camera" size={24} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickImage} tabIndex={-1} aria-label="Elegir captura" />
            <label htmlFor="chat-text" className="sr-only">Escribe o pega el mensaje</label>
            <textarea id="chat-text" rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} maxLength={4000}
              placeholder="Escribe o pega el mensaje…"
              className="max-h-40 min-h-[48px] flex-1 resize-none rounded-2xl bg-soft px-4 py-3 text-base placeholder:text-muted focus:bg-card focus:outline-none focus:ring-2 focus:ring-brand" />
            {text.trim() ? (
              <button type="submit" disabled={working} aria-label="Enviar"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand text-brand-ink disabled:opacity-50">
                <Icon name="send" size={22} />
              </button>
            ) : (
              <button type="button" onClick={rec.start} disabled={working} aria-label="Grabar un audio"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand text-brand-ink disabled:opacity-50">
                <Icon name="mic" size={24} />
              </button>
            )}
          </div>
        )}
        {rec.error && <p role="alert" className="px-2 pt-2 text-base text-danger">{rec.error}</p>}
      </form>
      {reportCase && <ReportSheet caseId={reportCase} onClose={() => setReportCase(null)} onCreated={refreshCredits} />}
    </div>
  );
}
