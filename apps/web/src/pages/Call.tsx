import { Link } from 'react-router-dom';
import { formatWait } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { FormError, Logo } from '../components/ui';
import { MAX_CALL_SEC, useWebCall } from '../hooks/useWebCall';

const STATUS = {
  idle: 'Cuéntale con calma lo que te llegó o lo que te dijeron. Te responde hablando.',
  connecting: 'Conectando con La Segura…',
  live: 'En llamada. Habla con calma, te está escuchando.',
  ended: 'La llamada terminó. Si revisaron algo, puedes escribir REPORTE o PUBLICAR al WhatsApp de La Segura.',
  error: '',
} as const;

/** Llamada de voz en vivo con el agente desde el navegador (celular o computador). */
export default function Call() {
  const { user } = useAuth();
  const call = useWebCall();
  const busy = call.state === 'connecting' || call.state === 'live';

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#1c5d7d] to-[#2cbbcb] p-6 text-white shadow-lg sm:p-8">
        <div className="flex flex-col items-center gap-5 text-center">
          <span className="relative grid h-36 w-36 place-items-center">
            {call.state === 'live' && <span aria-hidden="true" className="absolute inset-0 rounded-full bg-white/40 motion-safe:animate-ping" />}
            <span className="relative grid h-36 w-36 place-items-center rounded-full bg-white ring-8 ring-white/25">
              <Logo size={92} />
            </span>
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{call.state === 'live' ? 'Hablando con La Segura' : 'Llama a La Segura'}</h1>
            <p role="status" aria-live="polite" className="text-lg text-white/90">{STATUS[call.state]}</p>
            {call.state === 'live' && (
              <p className="text-3xl font-semibold tabular-nums" aria-label="Tiempo de llamada">
                <span role="timer">{formatWait(call.seconds)}</span><span className="text-lg text-white/70"> / {formatWait(MAX_CALL_SEC)}</span>
              </p>
            )}
          </div>
          {busy ? (
            <button type="button" onClick={call.hangup}
              className="inline-flex min-h-[64px] w-full max-w-xs items-center justify-center gap-3 rounded-full bg-[#d92d20] px-8 text-lg font-semibold text-white shadow-md hover:brightness-110">
              <Icon name="x" size={26} /> Colgar
            </button>
          ) : (
            <button type="button" onClick={() => void call.start()}
              className="inline-flex min-h-[64px] w-full max-w-xs items-center justify-center gap-3 rounded-full bg-white px-8 text-lg font-semibold text-[#1c5d7d] shadow-md hover:bg-white/90">
              <Icon name="phone" size={26} /> {call.state === 'ended' || call.state === 'error' ? 'Llamar otra vez' : 'Llamar ahora'}
            </button>
          )}
        </div>
      </section>

      {call.error && <FormError>{call.error}</FormError>}

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Así funciona</h2>
        <ul className="space-y-3 text-base">
          {[
            'Te pide permiso para usar el micrófono la primera vez.',
            'Cuéntale qué te escribieron, qué te dijeron o qué te ofrecieron.',
            'Te dice si parece una estafa y qué hacer. Si quieres, arma tu reporte o avisa a tus vecinos.',
            `Cada revisión cuesta 2 créditos. Tienes ${user?.credits ?? 0}. La llamada dura máximo 7 minutos.`,
          ].map((t, i) => (
            <li key={t} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{i + 1}</span>
              {t}
            </li>
          ))}
        </ul>
        <p className="text-base text-muted">
          ¿Prefieres escribir? <Link to="/app/revisar" className="font-semibold text-brand underline">Pega el mensaje aquí</Link>
        </p>
      </section>
    </div>
  );
}
