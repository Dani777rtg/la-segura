# Instalación y ejecución

Requisitos: Node 22+ (probado con 24), npm, Docker Desktop.

## 1. Variables de entorno (`.env` en la raíz, nunca se versiona)
| Variable | Para qué |
|---|---|
| `DEEPSEEK_API_KEY` | Análisis, relato del reporte, moderación |
| `DEEPGRAM_API_KEY` | Voz a texto y texto a voz |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API |
| `WHATSAPP_APP_SECRET` | Firma de los avisos entrantes (Meta App → Configuración → Básica). **Obligatoria para el bot.** |
| `WHATSAPP_VERIFY_TOKEN` | Apretón inicial del webhook (texto propio) |
| `WHATSAPP_TEST_NUMBER` | Único destinatario real en modo `test_only` (`57…`) |
| `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` | Pagos (credenciales de **producción**) |
| `DATOSGOV_APP_TOKEN` | Siembra de municipios (opcional) |
| `JWT_SECRET` | Firma de sesión y HMAC de indicadores (≥ 32 caracteres) |
| Opcionales | `WHATSAPP_SEND_MODE` (`fake` por defecto, `test_only`, `live`), `PUBLIC_BASE_URL`, `WEB_ORIGIN`, `MIN_CELL`, `TRUST_PROXY`, `DATABASE_URL`, `PORT` |

## 2. Arranque local
```bash
docker compose up -d                       # Postgres en 127.0.0.1:15432
npm install
npm run db:migrate -w apps/api             # esquema
npm run db:seed -w apps/api                # 1.122 municipios + polígonos de las 20 localidades
npm run db:seed-demo -w apps/api           # (opcional) datos de demostración rotulados
npm run dev -w apps/api                    # API  :3000
npm run dev -w apps/web                    # Web  :5173 (proxy a /api y /certificado)
```
En modo `fake` el código de verificación se imprime en la consola de la API (solo en desarrollo).
Para enviar el código por WhatsApp de verdad solo a tu número de pruebas: `WHATSAPP_SEND_MODE=test_only`.

## 3. Pruebas
```bash
docker exec <contenedor-db> psql -U parcero -c "CREATE DATABASE parcero_test"   # una sola vez
npm test -w apps/api      # 103 pruebas, Postgres real, servicios externos simulados
npm test -w apps/web      # 22 pruebas
npx tsc --noEmit -p apps/api && npx tsc --noEmit -p apps/web
```

## 4. Webhooks (externos)
- WhatsApp: `GET/POST /api/webhooks/whatsapp` (verify token + firma `X-Hub-Signature-256`).
- Mercado Pago: `POST /api/webhooks/mercadopago` (firma `x-signature`). Además `GET /api/credits/return` confirma el pago al volver el usuario.
Ambos necesitan una URL pública https.

## 5. Notas de entorno
- Los puertos 5432 y 55432 de este equipo los usan otros proyectos: Postgres usa **15432**.
- La carpeta está en OneDrive: considera pausar la sincronización (el `.env` se sincronizaría).

## 6. Despliegue en GCP (Cloud Run + Cloud SQL)
Imagen única (API + PWA): `Dockerfile` en la raíz. Proyecto `<proyecto-gcp>`, región `us-central1`.
```bash
gcloud builds submit --tag us-central1-docker.pkg.dev/<proyecto-gcp>/parcero/app:vN --region us-central1
gcloud run jobs update ps-migrate --image ...:vN --region us-central1 && gcloud run jobs execute ps-migrate --wait --region us-central1
gcloud run deploy ps-app --image ...:vN --region us-central1            # conserva variables y secretos
```
- Secretos en Secret Manager (`ps-*`). La app se conecta con el usuario **`parcero_app`**, sin permiso de editar, borrar ni vaciar el registro de reportes (`ps-migrate` aplica los permisos con `APP_DB_USER`).
- `TRUST_PROXY=1` (Cloud Run). `WEB_ORIGIN` y `PUBLIC_BASE_URL` = URL del servicio.
- Webhook de WhatsApp: app Meta "Parcero Seguro" → `…/api/webhooks/whatsapp` (campo `messages`). Se cambia con `POST /{app-id}/subscriptions` usando el token de app.
- **Activar el envío real de códigos a cualquier celular (exposición):**
  `gcloud run services update ps-app --region us-central1 --update-env-vars WHATSAPP_SEND_MODE=live`
  (cada código es una plantilla de pago; el límite de 1 código por IP/10 min sigue activo).
