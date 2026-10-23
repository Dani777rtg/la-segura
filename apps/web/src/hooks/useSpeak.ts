import { useEffect, useRef, useState } from 'react';
import { api, ApiError, formatWait } from '../api/client';

/** Lee en voz alta un texto (voz del servidor). Estados: idle | loading | playing. */
export function useSpeak(text: string) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef('');

  const cleanup = () => {
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = '';
    setState('idle');
  };
  useEffect(() => cleanup, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    if (state !== 'idle') { cleanup(); return; }
    setError('');
    setState('loading');
    try {
      const blob = await api.speak(text.slice(0, 600));
      url.current = URL.createObjectURL(blob);
      const a = new Audio(url.current);
      a.onended = cleanup;
      a.onerror = () => { cleanup(); setError('No pudimos reproducir el audio.'); };
      audio.current = a;
      await a.play();
      setState('playing');
    } catch (e) {
      cleanup();
      if (e instanceof ApiError) setError(e.status === 429 && e.retryAfterSec ? `${e.message} (${formatWait(e.retryAfterSec)})` : e.message);
      else setError('No pudimos reproducir el audio.');
    }
  };

  return { state, error, toggle };
}
