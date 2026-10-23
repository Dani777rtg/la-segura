import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Territory } from '../api/types';

export type View = 'col' | 'bog';
export interface Picked { name: string; count: number | null }

// Escala secuencial de un solo tono (del turquesa al azul marino del logo), de menos a más casos.
export const RAMP = ['#d9f3f6', '#9fe0e8', '#4fc3d1', '#2b8fae', '#1c5d7d'];
export const NO_DATA = '#e3e6ea';
export const bucket = (count: number, max: number) => Math.min(RAMP.length - 1, Math.max(0, Math.ceil((count / max) * RAMP.length) - 1));
const BOGOTA: L.LatLngTuple = [4.65, -74.1];
const COLOMBIA: L.LatLngBoundsExpression = [[-4.3, -79.1], [12.6, -66.8]];
const label = (name: string, count: number | null) => `<b>${name}</b><br>${count === null ? 'Pocos casos (no se muestra)' : `${count} ${count === 1 ? 'reporte' : 'reportes'}`}`;

/** Mapa de reportes: mapa base claro, zoom con botones grandes o pellizcando, y detalle al pasar o tocar una zona. */
export function TerritoryMap({ t, view, geo, onPick, resetKey }: {
  t: Territory; view: View; geo: GeoJSON.FeatureCollection | null; onPick: (p: Picked) => void; resetKey: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    // La rueda del mouse no hace zoom hasta que la persona toca el mapa (así no "atrapa" el scroll de la página).
    const m = L.map(box.current!, { scrollWheelZoom: false, zoomSnap: 0.5, minZoom: 4 })
    m.fitBounds(COLOMBIA)
    m.on('click', () => m.scrollWheelZoom.enable())
    m.on('mouseout', () => m.scrollWheelZoom.disable())
    // Mapa base de OpenStreetMap; se aclara con CSS (index.css) para que resalten los datos.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    if (view === 'col') {
      m.fitBounds(COLOMBIA);
      const max = Math.max(1, t.bogotaTotal, ...t.municipalities.map((x) => x.count));
      const dots = [{ name: 'Bogotá', ll: BOGOTA, count: t.bogotaTotal }, ...t.municipalities.map((x) => ({ name: `${x.name}, ${x.dept}`, ll: [x.lat, x.lon] as L.LatLngTuple, count: x.count }))];
      for (const d of dots.sort((a, b) => b.count - a.count)) {
        if (d.count <= 0) continue;
        L.circleMarker(d.ll, { radius: 7 + Math.sqrt(d.count / max) * 24, color: '#ffffff', weight: 2, fillColor: RAMP[bucket(d.count, max)], fillOpacity: 0.85 })
          .bindTooltip(label(d.name, d.count), { direction: 'top' })
          .on('click', () => onPick({ name: d.name, count: d.count })).addTo(g);
      }
    } else if (geo) {
      const byId = new Map(t.localities.map((l) => [l.id, l.count]));
      const max = Math.max(1, ...t.localities.map((l) => l.count ?? 0));
      const gj = L.geoJSON(geo, {
        style: (f) => {
          const p = f?.properties as { id: number; name: string };
          const c = byId.get(p.id) ?? null;
          const bosa = /bosa/i.test(p.name);
          return { color: bosa ? '#f5a524' : '#ffffff', weight: bosa ? 4 : 1.5, fillOpacity: 0.85, fillColor: c === null ? NO_DATA : RAMP[bucket(c, max)] };
        },
        onEachFeature: (f, lyr) => {
          const p = f.properties as { id: number; name: string };
          const c = byId.get(p.id) ?? null;
          lyr.bindTooltip(label(p.name, c), { sticky: true });
          lyr.on('click', () => onPick({ name: p.name, count: c }));
          lyr.on('mouseover', () => (lyr as L.Path).setStyle({ weight: 3, color: '#0f2f40' }));
          lyr.on('mouseout', () => gj.resetStyle(lyr));
        },
      }).addTo(g);
      m.fitBounds(gj.getBounds(), { padding: [12, 12] });
    }
  }, [view, t, geo, onPick, resetKey]);

  return <div ref={box} className="territory-map h-[60vh] min-h-[360px] w-full overflow-hidden rounded-2xl lg:h-[620px]" role="presentation" />;
}
