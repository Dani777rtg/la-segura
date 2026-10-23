const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

/** Barras por día en SVG simple, con resumen accesible. */
export function DailyBars({ daily }: { daily: { date: string; count: number }[] }) {
  if (daily.length === 0) return null;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const total = daily.reduce((s, d) => s + d.count, 0);
  const w = 280 / daily.length;
  const label = `Reportes por día, del ${short(daily[0].date)} al ${short(daily[daily.length - 1].date)}: ${total} en total.`;
  return (
    <figure className="card">
      <figcaption className="mb-2 font-bold">Reportes de los últimos {daily.length} días</figcaption>
      <svg viewBox="0 0 280 90" className="w-full" role="img" aria-label={label}>
        {daily.map((d, i) => {
          const h = (d.count / max) * 80;
          return <rect key={d.date} x={i * w + 2} y={85 - h} width={w - 4} height={Math.max(h, 1)} rx="3" fill="rgb(var(--brand))"><title>{`${short(d.date)}: ${d.count}`}</title></rect>;
        })}
      </svg>
      <p className="mt-1 flex justify-between text-xs text-muted"><span>{short(daily[0].date)}</span><span>Más alto: {max} en un día</span><span>{short(daily[daily.length - 1].date)}</span></p>
    </figure>
  );
}
