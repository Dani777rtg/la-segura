import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { saveSharedText } from '../hooks/sharedText';

/** Destino del Web Share Target: une ?text= y ?url= y lo lleva a Revisar. */
export default function Share() {
  const [params] = useSearchParams();
  const { user, loading } = useAuth();
  const text = [params.get('text'), params.get('url')].filter(Boolean).join('\n').slice(0, 4000);
  if (loading) return <p className="p-8 text-center font-bold" role="status">Cargando…</p>;
  if (!user) {
    saveSharedText(text);
    return <Navigate to="/entrar" replace state={{ from: '/app/revisar' }} />;
  }
  return <Navigate to="/app/revisar" replace state={{ text }} />;
}
