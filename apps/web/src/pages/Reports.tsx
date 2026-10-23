import { EmptyArt } from '../components/EmptyArt';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Report } from '../api/types';
import { FormError } from '../components/ui';
import { REPORT_TYPES, ReportActions } from '../components/ReportActions';

export default function Reports() {
  const [items, setItems] = useState<Report[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.reports().then((r) => setItems(r.items)).catch(() => setError('No pudimos cargar tus reportes.'));
  }, []);
  return (
    <div className="space-y-5">
      <Link to="/app/perfil" className="flex min-h-[48px] items-center font-bold text-brand">← Mi perfil</Link>
      <h1 className="text-2xl font-bold">Mis reportes</h1>
      {error && <FormError>{error}</FormError>}
      {!items && !error && <p role="status" className="font-bold">Cargando…</p>}
      {items?.length === 0 && (
        <div className="card flex flex-col items-center gap-3 py-10 text-center">
          <EmptyArt />
          <p className="text-lg font-semibold">Aún no tienes reportes</p>
          <p className="text-base text-muted">Cuando revises algo sospechoso podrás armar uno para denunciar.</p>
        </div>
      )}
      {items?.map((r) => (
        <section key={r.id} className="card space-y-3" aria-label={`Reporte ${r.code}`}>
          <div>
            <p className="font-bold">{r.code}</p>
            <p>{REPORT_TYPES[r.type] ?? REPORT_TYPES.generico}</p>
            <p className="text-sm text-muted">{new Date(r.createdAt).toLocaleDateString('es-CO', { dateStyle: 'long' })}</p>
          </div>
          <ReportActions id={r.id} code={r.code} />
        </section>
      ))}
    </div>
  );
}
