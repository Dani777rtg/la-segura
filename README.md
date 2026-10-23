# La Segura

Red social y asistente con IA contra el fraude digital, pensada para las familias de Bosa (Bogotá) y de toda Colombia, y en especial para personas mayores. Revisa mensajes, enlaces, audios, capturas y llamadas; contrasta con fuentes abiertas; arma el reporte para denunciar con un certificado verificable, y avisa a los vecinos.

**En vivo:** https://ps-app-119015175009.us-central1.run.app · **WhatsApp:** +57 302 403 6890

## Qué hace
- **Una sola asistente en todos los canales** (WhatsApp, app web instalable y llamadas), con **una sola memoria** por persona: lo que hablas por WhatsApp lo sabe la app y la llamada.
- **Entiende antes de actuar:** primero identifica la intención (revisar, preguntar, ya caí, publicar, reporte, saldo, fuera de tema…) y luego decide. Si no está claro, pregunta antes de cobrar.
- **Verifica con evidencia:** señales en el texto (pide claves o códigos, urgencia, premios, préstamos fáciles, falso familiar, enlaces que imitan marcas…) y, por cada enlace, antigüedad del dominio (RDAP), listas de phishing (OpenPhish), popularidad (Tranco), destino real del enlace (visita segura), empresa en el RUES (Confecámaras) y reportes de la comunidad.
- **Responde honesto:** cuatro niveles en palabras (muy probable, probablemente, podría ser, poco probable); nunca dice que algo "es seguro".
- **Reporte en PDF** para denunciar, con **cadena de hashes SHA-256** y QR verificable en `/certificado/<código>`.
- **Muro anónimo** de la comunidad, ordenado por cercanía (tu ciudad primero), con "a mí también" y publicación del mensaje exacto que llegó (sin datos personales).
- **Llamadas con IA** por WhatsApp y desde el navegador; **mapa** territorial anónimo; **consulta antes de pagar**; créditos y donaciones con Mercado Pago.

## Arquitectura
**Monolito modular** en Google Cloud, con un **servicio de voz aparte** para el tiempo real.

| Pieza | Tecnología | Qué hace |
|---|---|---|
| API (`apps/api`) | Node.js + TypeScript, Fastify, Drizzle · Cloud Run | Un solo servicio con módulos: `assistant` (entiende y decide), `agent` (verificación y reglas), `memory`, `feed`, `credits`, `reports`, `bot` (WhatsApp), `voice`, `presentation` |
| App (`apps/web`) | React + Vite + Tailwind, PWA instalable | Chat, llamada web, muro, perfil, mapa, consulta |
| Voz (`apps/voice`) | Python + Pipecat · VM en Google Cloud | Llamadas en vivo por WebRTC (WhatsApp Calling y navegador) |
| Base de datos | PostgreSQL 16 · Cloud SQL | Casos, memoria, muro, libro de créditos inmutable, cadena de reportes |
| IA | DeepSeek, Deepgram, Tesseract | Comprensión y análisis; voz a texto y texto a voz; lectura de imágenes |

## Calidad y seguridad
Lo que se hizo, y dónde está la evidencia:
- **Auditoría de seguridad OWASP Top 10:2025** con la skill `web-security-audit` (agente especializado en seguridad): ver [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md). Los hallazgos altos y medios se corrigieron y tienen pruebas en `apps/api/test/security.test.ts`.
- **200 pruebas automáticas** (161 de la API y 39 de la web): `npm test -w apps/api` y `npm test -w apps/web`.
- **Pruebas del comportamiento de la IA** con frases reales (intenciones, fuera de tema, manipulación) contra el modelo real.
- **Pruebas de carga** documentadas en [`docs/PERFORMANCE_TESTS.md`](docs/PERFORMANCE_TESTS.md).
- **Buenas prácticas guiadas por skills:** diseño con *Impeccable*, código simple con *Karpathy guidelines* y *Ponytail*, seguridad con *web-security-audit*.
- Avisos de Meta y Mercado Pago **firmados y verificados**, límites de uso, datos personales enmascarados, visita de enlaces que **nunca** entra a direcciones internas, secretos solo en variables de entorno (nunca en el repositorio).

## Arranque local
```bash
docker compose up -d && npm install
npm run db:migrate -w apps/api && npm run db:seed -w apps/api && npm run db:seed-demo -w apps/api
npm run dev -w apps/api      # :3000
npm run dev -w apps/web      # :5173
npm test -w apps/api && npm test -w apps/web
```
Variables en `.env` (ver `.env.example`; nunca se versiona). Más detalle en [`docs/SETUP.md`](docs/SETUP.md).

## Límites honestos
- El PDF es un soporte para denunciar, no la denuncia legal.
- La consulta a Policía/Fiscalía es una **simulación rotulada**: no existe una API pública.
- Los datos del muro y del mapa en la demo son **sintéticos y están rotulados**.
- La capacidad de 50.000 usuarios concurrentes **no se validó**: el máximo medido fue de unos 2.500 a 3.500.
