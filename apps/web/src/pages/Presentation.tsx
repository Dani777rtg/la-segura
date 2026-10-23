import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Logo } from '../components/ui';

// Número del bot de WhatsApp de La Segura y el mensaje con el que abre el chat.
const BOT_NUMBER = '573024036890';
const BOT_LINK = `https://wa.me/${BOT_NUMBER}?text=${encodeURIComponent('Hola')}`;
const qr = (data: string) => `/api/qr.svg?data=${encodeURIComponent(data)}`;

// Estilo común de las diapositivas: encabezado con línea, tarjetas claras y una tarjeta oscura que resalta lo principal.
const INK = '#0f2f40';
const MUTED = '#4a5a63';

function SlideHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-end justify-between gap-[3vw] border-b border-[#dfe5ea] pb-[2.5vh]">
      <div>
        <h1 className="text-[3.6vw] font-semibold leading-none tracking-[-0.03em]" style={{ color: INK }}>{title}</h1>
        <p className="mt-[1.2vh] text-[1.35vw]" style={{ color: MUTED }}>{subtitle}</p>
      </div>
      <Logo size={Math.round(window.innerHeight * 0.075)} />
    </div>
  );
}

function Card({ label, title, dark = false, children, className = '' }: { label: string; title: string; dark?: boolean; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col rounded-[1.2vw] p-[1.4vw] ${dark ? 'bg-[#0f2f40] text-white' : 'bg-[#f3f6f8]'} ${className}`}>
      <p className={`text-[1vw] font-semibold uppercase tracking-[0.14em] ${dark ? 'text-[#7fd6e1]' : 'text-[#2b8fae]'}`}>{label}</p>
      <h2 className="mt-[0.6vh] text-[2vw] font-semibold leading-none" style={dark ? undefined : { color: INK }}>{title}</h2>
      <div className="mt-[2vh] flex-1">{children}</div>
    </section>
  );
}

function Items({ items, dark = false, size = '1.15vw' }: { items: string[]; dark?: boolean; size?: string }) {
  return (
    <ul className="space-y-[1.3vh]">
      {items.map((i) => <li key={i} className="leading-snug" style={{ fontSize: size, color: dark ? undefined : INK }}>{i}</li>)}
    </ul>
  );
}

// Diapositiva 2: solo títulos, agrupados por canal. Primero lo de WhatsApp, como pidió el usuario.
const WHATSAPP = ['Mensajes de texto', 'Notas de voz', 'Llamadas con IA', 'Capturas de pantalla', 'Reportes legales en PDF', 'Certificado verificable con QR', 'Publicar en la red sin abrir la app'];
const SMS = ['Compartir un SMS a la app', 'Revisión automática al compartir'];
const APP = ['Chat con IA (texto, audio y captura)', 'Llamada con IA desde el navegador', 'Muro de la comunidad', 'Consulta antes de pagar', 'Mapa de estafas por zona', 'Perfil y publicaciones'];

// Diapositiva 3: lo que de verdad hace el sistema (sale del código: signals.ts, agent/service.ts, assistant/service.ts).
const SIGNALS = ['Pide claves o códigos', 'Te apura o amenaza', 'Premio o sorteo', 'Préstamo fácil', 'Pago "por error"', 'Falso familiar', 'Citación judicial', 'Tu línea o SIM', 'Ganancias fáciles', 'Enlace que imita una marca', 'Enlace acortado', 'Terminación riesgosa', 'Dirección numérica'];
const SOURCES = [
  'Antigüedad del dominio (RDAP)',
  'Listas de phishing (OpenPhish)',
  'Popularidad en internet (Tranco)',
  'Destino real del enlace (visita segura)',
  'Empresa en el RUES (Confecámaras, por NIT)',
  'Reportes de la comunidad (La Segura)',
];
const LEVELS: Array<[string, string]> = [['Muy probable', '#c41e24'], ['Probablemente', '#e0602c'], ['Podría ser', '#f5a524'], ['Poco probable', '#9aa7b0']];

/** Diapositivas en orden. Para agregar una, se añade aquí y el control del celular la ve sola. */
export const SLIDES: Array<{ title: string; render: () => ReactNode }> = [
  {
    title: 'La Segura',
    render: () => (
      <div className="grid h-full grid-cols-[1.1fr_1fr] gap-[2vw] px-[5vw] py-[7vh]">
        <div className="flex flex-col justify-center gap-[3.5vh]">
          <Logo size={Math.round(window.innerHeight * 0.12)} />
          <div>
            <h1 className="text-[6vw] font-semibold leading-[0.95] tracking-[-0.03em]" style={{ color: INK }}>La Segura</h1>
            <p className="mt-[2vh] max-w-[36vw] text-[1.6vw] leading-snug" style={{ color: MUTED }}>La red de vecinos que se avisan las estafas digitales, con una asistente que las revisa.</p>
          </div>
          <div className="grid max-w-[40vw] grid-cols-3 gap-[1vw]">
            {[['Revisa', 'mensajes, enlaces, audios y capturas'], ['Verifica', 'con fuentes abiertas y la comunidad'], ['Avisa', 'a tus vecinos y arma tu denuncia']].map(([t, d]) => (
              <div key={t} className="rounded-[1vw] bg-[#f3f6f8] p-[1.1vw]">
                <p className="text-[1.3vw] font-semibold" style={{ color: INK }}>{t}</p>
                <p className="mt-[0.6vh] text-[1vw] leading-snug" style={{ color: MUTED }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
        <section className="flex flex-col items-center justify-center gap-[3vh] rounded-[1.6vw] bg-[#0f2f40] p-[3vw] text-white">
          <p className="text-[1vw] font-semibold uppercase tracking-[0.14em] text-[#7fd6e1]">Pruébala ahora</p>
          <img src={qr(BOT_LINK)} alt="Código QR para escribirle al bot de La Segura por WhatsApp" className="aspect-square w-[min(26vw,52vh)] rounded-[1.2vw] bg-white p-[1.2vw]" />
          <div className="text-center">
            <p className="text-[1.8vw] font-semibold">Escanéalo y escríbele a La Segura</p>
            <p className="mt-[0.6vh] text-[1.3vw] text-white/75">WhatsApp · +57 302 403 6890</p>
          </div>
        </section>
      </div>
    ),
  },
  {
    title: 'Integraciones',
    render: () => (
      <div className="flex h-full flex-col px-[5vw] py-[6vh]">
        <SlideHeader title="Integraciones" subtitle="Desde dónde se usa La Segura" />
        <div className="grid flex-1 grid-cols-[1.25fr_0.85fr_1.15fr] gap-[1.2vw] pt-[3.5vh]">
          <Card label="Canal principal" title="WhatsApp" dark><Items items={WHATSAPP} dark size="1.3vw" /></Card>
          <Card label="Canal" title="SMS"><Items items={SMS} size="1.3vw" /></Card>
          <Card label="Canal" title="App web e instalable"><Items items={APP} size="1.3vw" /></Card>
        </div>
        <p className="pt-[2.5vh] text-[1.15vw]" style={{ color: MUTED }}>
          <span className="font-semibold" style={{ color: INK }}>Una sola asistente y una sola memoria</span> en todos los canales: lo que hablas por WhatsApp, lo sabe la app y la llamada.
        </p>
      </div>
    ),
  },
  {
    title: 'Cómo decide La Segura',
    render: () => (
      <div className="flex h-full flex-col px-[5vw] py-[6vh]">
        <SlideHeader title="Cómo decide La Segura" subtitle="De lo que te llegó a una respuesta clara, con evidencia" />
        <div className="grid flex-1 grid-cols-[1fr_1fr_2.4fr_1.15fr] gap-[1.2vw] pt-[3.5vh]">
          <Card label="Paso 1" title="Entra"><Items items={['Mensaje de texto', 'Nota de voz → texto (Deepgram)', 'Captura → texto (Tesseract)', 'Llamada en vivo']} /></Card>
          <Card label="Paso 2" title="Entiende"><Items items={['Memoria: WhatsApp, app y llamadas', 'Intención: revisar, preguntar, ya caí, publicar, reporte…', 'Si no es claro, pregunta antes de cobrar']} /></Card>
          <Card label="Paso 3" title="Verifica" dark>
            <div className="grid h-full grid-cols-[0.8fr_1.2fr] gap-[1.4vw]">
              <div>
                <p className="text-[1.05vw] font-semibold text-[#7fd6e1]">Señales en el texto <span className="font-normal text-white/70">(por ejemplo)</span></p>
                <ul className="mt-[1.2vh] space-y-[0.7vh]">{SIGNALS.map((x) => <li key={x} className="text-[0.98vw] leading-snug">{x}</li>)}</ul>
              </div>
              <div>
                <p className="text-[1.05vw] font-semibold text-[#7fd6e1]">Fuentes que consulta por cada enlace</p>
                <ul className="mt-[1.2vh] space-y-[1vh]">
                  {SOURCES.map((x) => {
                    const [name, src] = x.split(' (');
                    return <li key={x} className="text-[0.98vw] leading-snug">{name} <span className="text-white/65">({src}</span></li>;
                  })}
                </ul>
              </div>
            </div>
          </Card>
          <Card label="Paso 4" title="Decide">
            <Items items={['Reglas objetivas: solo suben el riesgo', 'DeepSeek analiza toda la evidencia', 'Responde en palabras, nunca "es seguro"', 'Qué hacer + reporte o alerta a vecinos']} />
            <div className="mt-[3vh] space-y-[0.8vh]">
              {LEVELS.map(([l, c]) => (
                <p key={l} className="flex items-center gap-[0.6vw] text-[1vw]" style={{ color: INK }}>
                  <span aria-hidden="true" className="inline-block h-[1vw] w-[1vw] rounded-full" style={{ background: c }} />{l}
                </p>
              ))}
            </div>
          </Card>
        </div>
        <p className="pt-[2.5vh] text-[1.15vw]" style={{ color: MUTED }}>
          <span className="font-semibold" style={{ color: INK }}>4 herramientas de la asistente:</span> analizar el mensaje · publicar la alerta · armar el reporte legal · ver el saldo
        </p>
      </div>
    ),
  },
  {
    title: 'Arquitectura',
    render: () => (
      <div className="flex h-full flex-col px-[5vw] py-[6vh]">
        <SlideHeader title="Arquitectura" subtitle="Monolito modular en Google Cloud, con un servicio de voz aparte para el tiempo real" />
        <div className="grid flex-1 grid-cols-[1fr_2.3fr_1fr_1.1fr] gap-[1.2vw] pt-[3.5vh]">
          <Card label="Entrada" title="Canales">
            <Items items={['WhatsApp Cloud API (Meta): mensajes, audios y llamadas', 'App web instalable (React)', 'SMS: compartir en Android']} />
          </Card>
          <Card label="Monolito modular · Google Cloud" title="Plataforma" dark>
            <div className="grid h-full grid-cols-3 gap-[1.2vw]">
              {[
                ['API · Cloud Run', 'Un solo servicio con módulos · Node.js + TypeScript', ['Asistente: entiende y decide', 'Verificación y reglas', 'Memoria de la conversación', 'Créditos y pagos', 'Reportes y certificado']],
                ['Servidor de voz', 'Servicio aparte · Pipecat (Python)', ['Llamadas en vivo por WebRTC', 'Voz a texto y texto a voz en tiempo real', 'Misma memoria y herramientas']],
                ['Base de datos', 'PostgreSQL · Cloud SQL', ['Casos y reputación', 'Memoria por persona', 'Muro de la comunidad', 'Libro de créditos', 'Cadena de hashes de reportes']],
              ].map(([t, sub, list]) => (
                <div key={t as string} className="rounded-[1vw] bg-white/10 p-[1vw]">
                  <p className="text-[1.2vw] font-semibold">{t as string}</p>
                  <p className="text-[0.95vw] text-[#7fd6e1]">{sub as string}</p>
                  <ul className="mt-[1.4vh] space-y-[0.9vh]">{(list as string[]).map((x) => <li key={x} className="text-[0.98vw] leading-snug">{x}</li>)}</ul>
                </div>
              ))}
            </div>
          </Card>
          <Card label="IA" title="Modelos">
            <Items items={['DeepSeek: comprensión y análisis', 'Deepgram: voz a texto y texto a voz', 'Tesseract: lectura de imágenes']} />
          </Card>
          <Card label="Externos" title="Fuentes y pagos">
            <Items items={['RDAP · OpenPhish · Tranco', 'RUES (datos.gov.co)', 'DIVIPOLA y mapas de Bogotá', 'Mercado Pago']} />
          </Card>
        </div>
        <p className="pt-[2.5vh] text-[1.15vw]" style={{ color: MUTED }}>
          <span className="font-semibold" style={{ color: INK }}>Seguridad:</span> avisos firmados de Meta y Mercado Pago · datos personales enmascarados · reportes con cadena de hashes SHA-256 y QR verificable
        </p>
      </div>
    ),
  },
  {
    title: 'Instálala en tu celular',
    render: () => (
      <div className="flex h-full flex-col px-[5vw] py-[6vh]">
        <SlideHeader title="Instálala en tu celular" subtitle="Es una app web: se instala desde el navegador, sin tienda y sin descargas" />
        <div className="grid flex-1 grid-cols-[1fr_1fr_1.05fr] gap-[1.2vw] pt-[3.5vh]">
          <Card label="Android" title="Con Chrome">
            <Steps items={['Abre el enlace en Chrome', 'Toca los tres puntos ⋮ arriba a la derecha', 'Toca "Instalar app" o "Agregar a pantalla principal"', 'Crea tu cuenta: el código llega por WhatsApp']} />
            <p className="mt-[2.5vh] text-[1.05vw]" style={{ color: MUTED }}>Extra: comparte un SMS sospechoso directo a La Segura.</p>
          </Card>
          <Card label="iPhone" title="Con Safari">
            <Steps items={['Abre el enlace en Safari', 'Toca Compartir (el cuadro con la flecha)', 'Toca "Agregar a pantalla de inicio"', 'Crea tu cuenta: el código llega por WhatsApp']} />
            <p className="mt-[2.5vh] text-[1.05vw]" style={{ color: MUTED }}>Para revisar un SMS: cópialo y pégalo en el chat, o reenvíalo por WhatsApp.</p>
          </Card>
          <section className="flex flex-col items-center justify-center gap-[2.5vh] rounded-[1.2vw] bg-[#0f2f40] p-[2vw] text-white">
            <p className="text-[1vw] font-semibold uppercase tracking-[0.14em] text-[#7fd6e1]">Escanea para abrirla</p>
            <img src={qr(APP_LINK)} alt="Código QR para abrir La Segura en el celular" className="aspect-square w-[min(19vw,40vh)] rounded-[1vw] bg-white p-[1vw]" />
            <p className="text-center text-[1.2vw] font-semibold">Se ve y se usa como una app, con su ícono en tu celular</p>
          </section>
        </div>
      </div>
    ),
  },
];

const APP_LINK = `${window.location.origin}/`;

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-[1.6vh]">
      {items.map((s, i) => (
        <li key={s} className="flex gap-[0.8vw] text-[1.2vw] leading-snug" style={{ color: INK }}>
          <span aria-hidden="true" className="grid h-[2vw] w-[2vw] shrink-0 place-items-center rounded-full bg-[#1c5d7d] text-[1vw] font-semibold text-white">{i + 1}</span>
          <span className="pt-[0.2vw]">{s}</span>
        </li>
      ))}
    </ol>
  );
}

const TOKEN_KEY = (code: string) => `ps_pres_${code}`;

/** Pantalla del computador: muestra la diapositiva actual y la sigue en vivo desde el celular. */
export default function Presentation() {
  const [params, setParams] = useSearchParams();
  const code = params.get('p');
  const [slide, setSlide] = useState(0);
  const [started, setStarted] = useState(false);
  const [token, setToken] = useState<string | null>(() => {
    try { return code ? sessionStorage.getItem(TOKEN_KEY(code)) : null; } catch { return null; }
  });
  const [error, setError] = useState('');

  // Crear la presentación (una vez) y guardar el código en la URL para que recargar no la pierda.
  useEffect(() => {
    if (code) return;
    fetch('/api/presentation', { method: 'POST', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((p: { code: string; token: string }) => {
        try { sessionStorage.setItem(TOKEN_KEY(p.code), p.token); } catch { /* sin storage */ }
        setToken(p.token);
        setParams({ p: p.code }, { replace: true });
      })
      .catch(() => setError('No pudimos crear la presentación. Recarga la página.'));
  }, [code, setParams]);

  // Seguir al celular: se consulta la diapositiva actual cada 0,7 s.
  useEffect(() => {
    if (!code) return;
    let alive = true;
    const tick = () => fetch(`/api/presentation/${code}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { slide: number } | null) => { if (alive && d) setSlide(Math.min(d.slide, SLIDES.length - 1)); })
      .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 700);
    return () => { alive = false; clearInterval(t); };
  }, [code]);

  // Con el teclado del computador también se avanza (flechas, espacio, Re Pág / Av Pág de un presentador).
  const go = useCallback((n: number) => {
    if (!code || !token) return;
    const next = Math.max(0, Math.min(SLIDES.length - 1, n));
    setSlide(next);
    void fetch(`/api/presentation/${code}/slide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, slide: next }) });
  }, [code, token]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) go(slide + 1);
      if (['ArrowLeft', 'PageUp'].includes(e.key)) go(slide - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, slide]);

  const start = () => { setStarted(true); void document.documentElement.requestFullscreen?.().catch(() => undefined); };
  const controlUrl = code && token ? `${window.location.origin}/presentacion/control?p=${code}&t=${encodeURIComponent(token)}` : '';

  if (!started) {
    return (
      <main className="grid min-h-screen place-items-center bg-white p-8">
        <div className="flex max-w-3xl flex-col items-center gap-6 text-center">
          <Logo size={64} />
          <h1 className="text-3xl font-semibold text-[#0f2f40]">Controla la presentación desde tu celular</h1>
          <p className="text-lg text-[#4a5a63]">Escanea este código con tu celular. Ahí tendrás los botones para pasar las diapositivas. En el computador también sirven las flechas del teclado.</p>
          {error && <p role="alert" className="text-lg text-danger">{error}</p>}
          {controlUrl ? <img src={qr(controlUrl)} alt="Código QR del control remoto" className="h-64 w-64 rounded-2xl bg-white p-3 shadow" /> : !error && <p role="status">Preparando…</p>}
          <button type="button" onClick={start} disabled={!code} className="btn-primary w-auto px-10">Empezar en pantalla completa</button>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-white font-sans" aria-live="polite" aria-label={`Diapositiva ${slide + 1} de ${SLIDES.length}: ${SLIDES[slide]!.title}`}>
      {SLIDES[slide]!.render()}
    </main>
  );
}
