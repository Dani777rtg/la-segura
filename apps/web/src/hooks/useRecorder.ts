import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_REC_SEC = 30;

/** Graba audio con MediaRecorder. Libera siempre el micrófono al detener o desmontar. */
export function useRecorder(onDone: (blob: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const done = useRef(onDone);
  done.current = onDone;

  const stop = useCallback(() => { if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); }, []);

  const start = useCallback(async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Tu celular no deja grabar desde aquí. Escribe el mensaje y lo revisamos igual.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('No pudimos usar el micrófono. Puedes darle permiso en los ajustes o escribir el mensaje.');
      return;
    }
    const r = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      clearInterval(timer.current);
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      rec.current = null;
      done.current(new Blob(chunks, { type: r.mimeType || 'audio/webm;codecs=opus' }));
    };
    rec.current = r;
    r.start();
    setSeconds(0);
    setRecording(true);
    let n = 0;
    timer.current = setInterval(() => { n += 1; setSeconds(n); if (n >= MAX_REC_SEC) stop(); }, 1000);
  }, [stop]);

  useEffect(() => () => {
    clearInterval(timer.current);
    const r = rec.current;
    if (r) {
      r.onstop = null;
      if (r.state !== 'inactive') r.stop();
      r.stream.getTracks().forEach((t) => t.stop());
    }
  }, []);

  return { recording, seconds, error, start, stop };
}
