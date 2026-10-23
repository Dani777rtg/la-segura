import { useCallback, useEffect, useState } from 'react';

/** Cuenta regresiva en segundos. start(n) la reinicia; remaining llega a 0 y se detiene. */
export function useCountdown(initial = 0) {
  const [remaining, setRemaining] = useState(initial);
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);
  const start = useCallback((sec: number) => setRemaining(Math.max(0, Math.ceil(sec))), []);
  return { remaining, start };
}
