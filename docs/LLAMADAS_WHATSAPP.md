# Llamadas por WhatsApp al bot — investigación (22-oct-2026)

Objetivo: que una persona toque "Llamar" en el chat de Parcero Seguro y le diga al agente: *"hola, ¿esto es una estafa?"*, sin teclear.

## Hallazgos verificados
| Tema | Qué encontré | Fuente |
|---|---|---|
| ¿Existe? | Sí: **WhatsApp Business Calling API**. Soporta llamadas que inicia la persona al número de la empresa ("user-initiated"), disponibles donde exista Cloud API. | [Meta: Calling API](https://developers.facebook.com/docs/whatsapp/cloud-api/calling) |
| Requisito principal | La empresa debe tener un **límite diario de mensajería de al menos 2.000 destinatarios únicos**. Cloud API (no la app de WhatsApp Business). Suscribirse al campo de webhook `calls`, tener el permiso `whatsapp_business_messaging` y activar llamadas en el número. | [Meta: Calling API](https://developers.facebook.com/docs/whatsapp/cloud-api/calling), [ajustes de llamadas](https://developers.facebook.com/docs/whatsapp/cloud-api/calling/call-settings) |
| **Nuestro límite real** | **TIER_2K = 2.000. Cumple el requisito.** (El campo `messaging_limit_tier` que consulté antes está obsoleto y mostraba `TIER_250`: me equivoqué al decir que no cumplíamos. Se lee con `whatsapp_business_manager_messaging_limit`.) | Consulta a la API de Meta, 22-oct |
| Estado actual del número | Llamadas **sin activar** (`calling.status = NOT_SET`). Activarlas es un `POST /<phone-number-id>/settings` con `calling.status = ENABLED`. | Consulta a la API de Meta, 22-oct |
| Costo de Meta | **Las llamadas iniciadas por la persona son gratis.** Las iniciadas por la empresa se cobran por minuto (no las usaríamos). | [Meta: precios de llamadas](https://developers.facebook.com/docs/whatsapp/cloud-api/calling/pricing) |
| Cómo se conecta | Llega un webhook `calls` con evento `connect` y una oferta **WebRTC (SDP)**. Hay que responder `pre_accept`/`accept` con una respuesta SDP en 30–60 s y luego mover el audio (Opus) por WebRTC. Se cuelga con `terminate`. | [Meta: llamadas iniciadas por el usuario](https://developers.facebook.com/docs/whatsapp/cloud-api/calling/user-initiated-calls) |
| Alternativa | Meta también permite **SIP** (en vez de WebRTC directo) hacia un proveedor de telefonía. | [ajustes de llamadas](https://developers.facebook.com/docs/whatsapp/cloud-api/calling/call-settings) |

## Qué haría falta construir
1. Activar llamadas en el número y suscribir el campo `calls` de la app "Parcero Seguro".
2. Un **servidor de medios WebRTC** que reciba el audio de la persona, lo pase a Deepgram en tiempo real (voz a texto), lo analice con el agente (DeepSeek) y devuelva la respuesta hablada (texto a voz) como audio por la misma llamada.
3. Manejo de turnos de habla (cuándo la persona terminó de hablar), cortes y llamadas caídas.

## El obstáculo técnico principal
**Cloud Run no acepta tráfico UDP entrante** (según mi conocimiento de la plataforma; confirmar antes de decidir), y el audio de WebRTC viaja por UDP. Opciones:
| Opción | Qué implica | Esfuerzo estimado* | Riesgo |
|---|---|---|---|
| A. **Máquina virtual** (Compute Engine) con IP pública y puertos UDP abiertos, ejecutando un servidor WebRTC en Node (p. ej. `werift`) o uno ya hecho | Recurso nuevo con costo por hora (centavos al día), códec Opus en servidor, firewall | 10–16 h para un MVP que funcione | Alto: ICE/DTLS, latencia, audio entrecortado |
| B. **SIP** hacia un proveedor de telefonía con "streams" por WebSocket (que sí funciona en Cloud Run) | Cuenta con un proveedor, costo por minuto, configuración SIP con credenciales de Meta | 8–14 h | Alto: dependencia de un tercero y de documentación de interconexión |
| C. Servicio de agentes de voz ya hecho que acepte WhatsApp | No investigado a fondo | ? | ? |
\*Estimaciones propias, sin medir. Costos de infraestructura: por estimar antes de pedir autorización.

## Recomendación
- **No construirlo para mañana (8:00 a. m.):** es el cambio más grande del proyecto, necesita infraestructura nueva que aún no existe y no se puede probar bien sin teléfonos y tiempo.
- **No activar las llamadas en el número todavía:** si se activa el botón "Llamar" sin tener quién conteste, cada llamada sonaría sin respuesta ("No contestó") y se vería mal.
- **Para el pitch:** "ya cumplimos el requisito de Meta (2.000) y las llamadas iniciadas por la persona son gratis" → siguiente paso del proyecto.
- **Hoy, lo más parecido que sí funciona:** notas de voz por WhatsApp (el bot responde con voz) y el botón de voz de la app. Opcional, más pequeño (unas 3 h): un **modo "conversación"** en la app que escucha, responde en voz y vuelve a escuchar sin tocar nada.
