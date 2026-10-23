import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { FRAUD_TYPES } from '../api/types';
import { useLoad } from '../hooks/useLoad';
import { DailyBars } from '../components/DailyBars';
import { Icon } from '../components/Icon';
import { FormError } from '../components/ui';
import { NO_DATA, RAMP, TerritoryMap, type Picked, type View } from '../components/TerritoryMap';

export default function MapPage() {
  const { data: t, error, loading } = useLoad(() => api.territory());
  const [view, setView] = useState<View>('col');
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geoError, setGeoError] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (view === 'bog' && !geo) api.bogotaGeojson().then(setGeo, () => setGeoError(true));
  }, [view, geo]);
  useEffect(() => setPicked(null), [view]);

  // Lista accesible: las zonas con más casos (también sirve a quien no usa el mapa).
  const zones = t ? [
    ...t.localities.filter((l) => l.count !== null).map((l) => ({ name: `${l.name} (Bogotá)`, count: l.count as number })),
    ...t.municipalities.map((m) => ({ name: `${m.name}, ${m.dept}`, count: m.count })),
  ].sort((a, b) => b.count - a.count).slice(0, 10) : [];
  const top = zones[0]?.count ?? 1;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Mapa de estafas</h1>
        {t && <p className="text-base text-muted">{t.total.toLocaleString('es-CO')} reportes en los últimos {t.windowDays} días. Solo totales por zona, nunca datos de personas.</p>}
      </div>
      {loading && <p role="status" className="text-lg font-semibold">Cargando…</p>}
      {error && <FormError>{error}</FormError>}
      {t && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="card space-y-3 p-3 sm:p-4" aria-label="Mapa">
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Vista del mapa" className="inline-flex rounded-xl bg-soft p-1">
                {([['col', 'Colombia'], ['bog', 'Bogotá por localidad']] as const).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                    className={`min-h-[44px] rounded-lg px-4 text-base font-medium ${view === v ? 'bg-card text-brand shadow-sm' : 'text-muted'}`}>{l}</button>
                ))}
              </div>
              <button type="button" onClick={() => setResetKey((k) => k + 1)} className="ml-auto inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-base font-medium text-muted hover:bg-soft">
                <Icon name="pin" size={20} /> Centrar
              </button>
            </div>
            <TerritoryMap t={t} view={view} geo={geo} onPick={setPicked} resetKey={resetKey} />
            {geoError && view === 'bog' && <FormError>No pudimos cargar las localidades.</FormError>}
            <p className="px-1 text-sm text-muted">Usa + y − para acercar, o pellizca en el celular. Toca una zona para ver sus reportes.</p>
          </section>

          <div className="space-y-5">
            <p role="status" className="card text-base">
              {picked
                ? picked.count === null ? <><b>{picked.name}</b>: menos de {t.minCell} casos, no se muestra.</> : <><b>{picked.name}</b>: {picked.count} {picked.count === 1 ? 'reporte' : 'reportes'}</>
                : 'Toca una zona del mapa para ver cuántos reportes tiene.'}
            </p>
            {t.includesDemo && <p className="flex items-center gap-2 rounded-2xl bg-sun/30 p-3 text-base font-medium"><Icon name="flask" size={20} />Incluye datos de demostración (sintéticos)</p>}
            <section className="card space-y-2 text-base" aria-label="Leyenda">
              <h2 className="text-lg font-semibold">Cómo leerlo</h2>
              <p className="flex items-center gap-1">Menos
                {RAMP.map((c) => <span key={c} className="inline-block h-4 w-7 rounded" style={{ background: c }} aria-hidden="true" />)}
                Más
              </p>
              {view === 'col' ? <p className="text-muted">Entre más grande y oscuro el círculo, más reportes.</p> : (
                <>
                  <p className="flex items-center gap-2 text-muted"><span className="inline-block h-4 w-7 rounded" style={{ background: NO_DATA }} aria-hidden="true" />Menos de {t.minCell} casos: no se muestra</p>
                  <p className="text-muted">Bosa va con borde naranja.</p>
                </>
              )}
            </section>
            <section aria-label="Zonas con más casos" className="card">
              <h2 className="mb-3 text-lg font-semibold">Zonas con más casos</h2>
              {zones.length === 0 ? <p className="text-muted">Aún no hay zonas con casos suficientes.</p> : (
                <ol className="space-y-2.5">{zones.map((z) => (
                  <li key={z.name} className="space-y-1">
                    <div className="flex justify-between gap-3 text-base"><span>{z.name}</span><b>{z.count}</b></div>
                    <div className="h-2 rounded-full bg-soft" aria-hidden="true"><div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(6, (z.count / top) * 100)}%` }} /></div>
                  </li>
                ))}</ol>
              )}
            </section>
            <section aria-label="Estafas más reportadas" className="card">
              <h2 className="mb-2 text-lg font-semibold">Estafas más reportadas</h2>
              {t.byType.length === 0 ? <p className="text-muted">Sin datos todavía.</p> : (
                <ul className="space-y-2">{t.byType.map((b) => (
                  <li key={b.fraudType} className="flex justify-between gap-3 text-base"><span>{FRAUD_TYPES[b.fraudType] ?? b.fraudType}</span><b>{b.count}</b></li>
                ))}</ul>
              )}
            </section>
            <DailyBars daily={t.daily} />
          </div>
        </div>
      )}
    </div>
  );
}
