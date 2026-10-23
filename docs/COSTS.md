# Costos

Objetivo: GCP lo más cerca posible de cero. **No se ha creado ningún recurso en GCP.** Todo el desarrollo es local (Docker).

## Costos reales hasta ahora
| Concepto | Detalle |
|---|---|
| GCP | USD 0 (sin recursos) |
| Meta / WhatsApp | 1 mensaje de plantilla de autenticación real al número de pruebas (tarifa por verificar en Meta Business; pagada por la empresa) |
| DeepSeek / Deepgram | Pruebas puntuales (fracciones de centavo) |
| Mercado Pago | Se creó 1 preferencia de pago de prueba; **no se cobró nada** |

## Servicios de GCP propuestos (solo el día de la exposición, previa autorización)
| Servicio | Por qué | Alternativa gratuita | Notas |
|---|---|---|---|
| Cloud SQL for PostgreSQL (instancia mínima, 10 GB) | Transacciones y libro de créditos; decisión del usuario | Neon/Supabase (nivel gratuito, no GCP) | Cobra por hora + disco aunque esté detenida (el disco). **Eliminar al terminar.** Estimación: centavos a pocos USD por un día; **verificar tarifa vigente antes de crear** |
| Cloud Run (API + PWA estática), mín. 0 instancias | URL pública para WhatsApp, Mercado Pago y el jurado | Túnel cloudflared (gratis, solo desarrollo) | Escala a cero; nivel gratuito cubre el uso previsto |
| Artifact Registry / Cloud Build | Imagen del contenedor | Construir local y subir | Pequeños costos de almacenamiento: eliminar al final |

## Costos de terceros (aparte de GCP)
- **WhatsApp**: el código de verificación usa plantilla de autenticación (de pago, por mensaje). El bot **solo responde**, dentro de la ventana de 24 h iniciada por la persona.
- **DeepSeek** (≈ 1 llamada por análisis), **Deepgram** (STT/TTS), **Mercado Pago** (comisión por pago aprobado).
- Márgenes de crédito: 200 créditos gratis por usuario ≈ 200 análisis de texto; el costo de IA por análisis es una fracción de centavo.

## Límite de gasto
Las alertas de presupuesto de GCP no son un tope automático. Por eso: instancias con máximo bajo en Cloud Run, y eliminación manual de Cloud SQL al terminar. **Alertas/presupuestos: no configurados todavía.**

## Limpieza (al terminar, con confirmación)
Cloud Run service, Cloud SQL (después de `pg_dump`), imágenes del registro, cualquier IP reservada. Ver `docs/SETUP.md`.

---

## Recursos de GCP CREADOS (22-oct-2026, autorizados por el usuario)
Proyecto nuevo **`<proyecto-gcp>`** (número 119015175009), cuenta de facturación `<cuenta-de-facturacion>`, región `us-central1`.

| Recurso | Detalle | Costo / notas |
|---|---|---|
| Cloud SQL `parcero-db` | PostgreSQL 16, `db-f1-micro`, 10 GB SSD, sin HA, **sin respaldos**, IP pública sin redes autorizadas (acceso solo por el conector de Cloud Run) | Estimado < USD 1/día (cobra por hora aunque no se use; el disco también). **Eliminar al terminar.** |
| Cloud Run `ps-app` | 1 vCPU / 1 GiB, mín. 0 instancias, máx. 3, concurrencia 20 | Dentro del nivel gratuito para el uso previsto |
| Cloud Run Jobs | `ps-migrate`, `ps-seed`, `ps-seed-demo` | Centavos |
| Artifact Registry `parcero` | Imágenes `app:v1`, `app:v2` | Dentro de los 0,5 GB gratuitos (revisar) |
| Cloud Build | 2 construcciones (~2 min c/u) | Dentro de los 120 min/día gratuitos |
| Secret Manager | 11 secretos | Centavos al mes |
| Presupuesto | **40.000 COP (~USD 10)**, alertas al 50 % y 100 % | Solo avisa por correo: **no corta el gasto** |

URL pública: `https://ps-app-119015175009.us-central1.run.app` (usar siempre esta; la otra URL de Cloud Run no coincide con `WEB_ORIGIN`).
Modo de WhatsApp en producción: `test_only` (solo envía de verdad al número de pruebas). Para la exposición se cambia a `live` (ver `docs/SETUP.md`).

### Limpieza (hacer después de la exposición, con confirmación del usuario)
```
gcloud projects delete <proyecto-gcp>      # elimina TODO lo de arriba de una vez
```
o, para conservar el proyecto: borrar `parcero-db`, el servicio `ps-app`, los jobs, el repositorio `parcero` y los secretos.

### Estado de WhatsApp en producción (23-oct-2026)
- `WHATSAPP_SEND_MODE=live`: se envía el código de verificación a **cualquier** celular. Cada registro = 1 plantilla de autenticación de pago (tarifa por Colombia: **verificar en la facturación de Meta**).
- `SIGNUP_CAP=44`: tope de cuentas reales (no demo). Ya existen 4 (la del dueño y 3 de prueba), así que caben **40 registros nuevos**. Al llegar al tope el registro responde 403 `signup_cap_reached` y no se envía ningún mensaje. Cambiar: `gcloud run services update ps-app --region us-central1 --update-env-vars SIGNUP_CAP=<n>`.
- Nivel de mensajería del número: `TIER_250` (hasta 250 destinatarios únicos iniciados por la empresa cada 24 h): suficiente para el tope.
- Volver a modo seguro: `--update-env-vars WHATSAPP_SEND_MODE=test_only`.


### Máquina virtual de llamadas (23-oct-2026, autorizada por el usuario)
| Recurso | Detalle | Costo |
|---|---|---|
| VM `ps-voice` | e2-medium, Debian 12, 20 GB, us-central1-a, siempre encendida | ~USD 0,8-1/día (tarifa por verificar) |
| IP fija `ps-voice-ip` | <ip-de-la-vm> | centavos por hora |
| Firewall `ps-voice-web`, `ps-voice-media` | tcp 80/443 y udp 1024-65535 hacia la VM | sin costo |
| Deepgram / DeepSeek | por minuto de audio / por consulta | por minuto de llamada |
| Meta | llamadas iniciadas por la persona: gratis | 0 |
Limpieza: `gcloud compute instances delete ps-voice` y `gcloud compute addresses delete ps-voice-ip --region us-central1` (o borrar el proyecto completo).
