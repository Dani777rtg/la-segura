import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Logo } from '../components/ui';
import { SLIDES } from './Presentation';

/** Control remoto en el celular: dos botones grandes para pasar las diapositivas del computador. */
export default function PresentationControl() {
  const [params] = useSearchParams();
  const code = params.get('p') ?? '';
  const token = params.get('t') ?? '';
  const [slide, setSlide] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/presentation/${code}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: { slide: number }) => setSlide(Math.min(d.slide, SLIDES.length - 1)))
      .catch(() => setError('Este enlace de control no es válido. Escanea otra vez el QR del computador.'));
  }, [code]);

  const go = async (n: number) => {
    const next = Math.max(0, Math.min(SLIDES.length - 1, n));
    setSlide(next);
    navigator.vibrate?.(15);
    const r = await fetch(`/api/presentation/${code}/slide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, slide: next }) }).catch(() => null);
    setError(r?.ok ? '' : 'No se pudo cambiar la diapositiva. Revisa tu internet.');
  };

  return (
    <main className="flex min-h-[100dvh] flex-col gap-4 bg-[#0f2f40] p-5 text-white">
      <header className="flex items-center gap-3">
        <span className="rounded-xl bg-white p-1"><Logo size={36} /></span>
        <div>
          <p className="text-lg font-semibold">Control de la presentación</p>
          <p className="text-base text-white/75" role="status">Diapositiva {slide + 1} de {SLIDES.length}: {SLIDES[slide]?.title}</p>
        </div>
      </header>
      {error && <p role="alert" className="rounded-xl bg-white/10 p-3 text-base">{error}</p>}
      <button type="button" onClick={() => void go(slide + 1)} disabled={slide >= SLIDES.length - 1}
        className="flex flex-[2] items-center justify-center gap-3 rounded-3xl bg-white text-3xl font-semibold text-[#0f2f40] active:scale-[0.99] disabled:opacity-40">
        Siguiente <Icon name="send" size={32} />
      </button>
      <button type="button" onClick={() => void go(slide - 1)} disabled={slide <= 0}
        className="flex flex-1 items-center justify-center rounded-3xl bg-white/15 text-2xl font-semibold ring-1 ring-white/30 active:scale-[0.99] disabled:opacity-40">
        Anterior
      </button>
    </main>
  );
}
