import { useCallback, useEffect, useState } from 'react';
import { errMsg } from '../api/client';

/** Carga un dato al montar; `reload` lo vuelve a pedir. */
export function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // fn se captura una sola vez (los llamadores pasan una llamada fija a la API).
  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    return fn().then(setData, (e) => setError(errMsg(e))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}
