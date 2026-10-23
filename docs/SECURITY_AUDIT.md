# Auditoría de seguridad: Parcero Seguro

Fecha: 2026-10-22. Alcance: `apps/api` y `apps/web` (código actual, sin repo git). Modo: solo lectura del código; se ejecutaron `npm audit`, las 103 pruebas existentes (todas pasan contra `parcero_test`) y un script temporal con `app.inject` y servicios simulados (`/scratchpad/poc.mts`, fuera del repo). No se tocó la BD `parcero`, no se llamó a ningún servicio externo, no se imprimió ningún secreto.

## Resumen ejecutivo

El núcleo está bien construido: consultas parametrizadas, control de propiedad correcto en casos, reportes y PDFs, webhooks firmados con comparación en tiempo constante, pagos confirmados contra la API de Mercado Pago con monto, moneda e idempotencia, OTP robusto. Hay **1 hallazgo Alto de lógica de cuentas** (secuestro del registro de un celular ajeno, reproducido) y **1 Alto condicionado al despliegue** (`TRUST_PROXY=true` permite falsificar la IP y saltarse los límites de OTP y login, reproducido). Hay 5 Medios (envenenamiento de la reputación, evasión del umbral k del mapa, carrera de créditos que da IA gratis, "inmutabilidad" del libro más débil de lo que dice, DoS por verificación/OCR). No hay secretos en el repo ni inyección SQL/XSS encontrada. Para el pitch, corregir A-01 y A-02 y dejar claro que el libro es verificable pero no anclado.

Conteo: Crítico 0, Alto 2, Medio 6, Bajo 7, Informativo 6.

Leyenda: CONFIRMADO = reproducido o visto en el código sin duda. PLAUSIBLE = depende de despliegue o de un servicio que no pude ejercitar.

---

## Hallazgos

### A-01 (Alto, CONFIRMADO) Secuestro del registro de un celular antes de que se verifique
- Archivo: `apps/api/src/modules/auth/repo.ts:19-37` (`upsertUnverifiedUser`) y `apps/api/src/modules/auth/service.ts:46-61`.
- Qué pasa: `register` sobrescribe nombre, contraseña, municipio y localidad de cualquier usuario NO verificado con ese celular, y lo hace **antes** de aplicar los límites de `sendCode`. Aunque el límite de 10 min responda 429 (el nuevo código no se envía), la contraseña ya fue reemplazada y el código anterior (de la víctima) sigue vigente.
- Explotación: la víctima se registra (recibe el código C1). Antes de que lo escriba, el atacante hace `POST /api/auth/register` con el celular de la víctima y su propia contraseña. Responde 429, pero la contraseña quedó cambiada. La víctima verifica con C1 y queda con cuenta verificada cuya contraseña es la del atacante; el atacante inicia sesión. Variante sin carrera: el atacante registra el celular de otra persona y la convence de "leerle el código" que le llega por WhatsApp; la cuenta queda con la contraseña del atacante.
- Evidencia ejecutada (`poc.mts`, secciones A):
  ```
  A1 victim register 202
  A2 attacker re-register (sendCode blocked?) 429
  A3 victim verify with own code 200 Atacante
  A4 ATTACKER LOGIN with attacker password 200 Atacante
  A5 victim login with own password 401
  ```
  Nótese que el nombre de la cuenta de la víctima pasó a ser "Atacante".
- Corrección mínima: (1) mover los tres `hit(...)` de `sendCode` al inicio de `register`, antes del upsert; (2) hacer upsert + `invalidateOtps` + `createOtp` en una sola transacción, de modo que reescribir los datos siempre invalide el código previo y solo ocurra cuando se envía uno nuevo. Mejor aún: no escribir la contraseña en `users` hasta que el OTP se verifique (guardar el hash en `otp_codes` y copiarlo en `markPhoneVerified`).

### A-02 (Alto si `TRUST_PROXY=true`, CONFIRMADO el comportamiento; el despliegue real es PLAUSIBLE) IP falsificable por `X-Forwarded-For`
- Archivo: `apps/api/src/config.ts:17` y `apps/api/src/server.ts:48` (`trustProxy: config.TRUST_PROXY`, booleano). Afecta `auth/service.ts:27,99`, `reports/routes.ts:42,53` y el `@fastify/rate-limit` global.
- Qué pasa: con `trustProxy: true` Fastify confía en todos los saltos y toma como `req.ip` el primer valor de `X-Forwarded-For`, que el cliente controla.
- Explotación: el límite "una IP pide un código cada 10 min" es la única barrera global contra usar la plataforma para enviar plantillas de pago de WhatsApp a muchos celulares ajenos (denial of wallet y acoso). Cambiando el header en cada petición se elimina. También se elimina el tope de 10 intentos de login (`login:${ip}:${phone}`) permitiendo adivinar contraseñas sin límite, y el límite global de 300/min.
- Evidencia ejecutada (4 registros de celulares distintos desde el mismo socket, XFF distinto):
  ```
  B TRUST_PROXY=false -> 202,429,429,429
  B TRUST_PROXY=true  -> 202,202,202,202
  ```
- Corrección: en producción usar el número exacto de saltos (`trustProxy: 1` para Cloud Run detrás del balanceador de Google; confirmar cuántos saltos reales hay) en vez de `true`. Cambiar `TRUST_PROXY` a número. Si no se despliega con proxy, dejar `false` (el valor actual por defecto es correcto).

### A-03 (Medio, CONFIRMADO) La reputación comunitaria se puede envenenar con dominios y números inocentes
- Archivo: `apps/api/src/modules/agent/service.ts:121-130,148-150`, `lookup/service.ts:30-44`.
- Qué pasa: cualquier análisis con riesgo distinto de `bajo` guarda como indicador los dominios y celulares que contiene el texto, sin importar si ese dominio tuvo alguna señal real. El riesgo lo fija la IA a partir de texto que controla el usuario (y las reglas, que se activan con palabras como "urgente"). Con 3 cuentas verificadas, cualquier dominio o celular queda como "peligro" para toda la comunidad.
- Explotación: un competidor o enemigo analiza "urgente, tu cuenta será bloqueada, entra a tienda-de-fulano.com" desde 3 cuentas (cada una cuesta un número de WhatsApp, pero regalan 200 créditos) y la tienda queda marcada "peligro" en `/lookup`. Lo mismo con el celular de una persona.
- Evidencia: dos usuarios analizan texto con `negocio-legitimo-ejemplo.com` (FakeLlm devuelve riesgo alto); un tercero consulta `/api/lookup`: `F lookup domain of an arbitrary (innocent) site -> alerta 2`.
- Corrección: guardar el indicador solo si hay evidencia independiente del texto (lista de phishing, dominio joven, imitación de marca) o si el veredicto es `alto`; excluir `OFFICIAL_DOMAINS` y dominios de una lista de confianza; no tratar como evidencia el riesgo que dependa solo de la IA; para el nivel `peligro` exigir cuentas con antigüedad mínima.

### A-04 (Medio, CONFIRMADO) El umbral de anonimato del mapa (`MIN_CELL`) se evade
- Archivo: `apps/api/src/modules/territory/service.ts:20-60`.
- Qué pasa: (1) La respuesta pública incluye `bogotaTotal` (suma real de todas las localidades, incluidas las ocultas), `total` y `byType`. Restando la suma de las celdas visibles se obtiene exactamente lo que está oculto. (2) El umbral cuenta casos, no personas: un solo usuario con 3 análisis hace visible su propia celda. (3) Consultando cada minuto (la caché es de 60 s) se ve el instante exacto en que cambia `bogotaTotal` o `daily`, lo que correlaciona un reporte con una persona.
- Evidencia: 2 casos en Bosa con k=3: `{"bosa":{"id":7,"name":"Bosa","count":null},"bogotaTotal":2,"visibleSum":0}`. Con una sola celda oculta el número real queda expuesto.
- Corrección: calcular `bogotaTotal`, `total` y `byType` solo desde celdas visibles, o aplicar supresión complementaria; contar `count(distinct user_id)` en el `HAVING` en lugar de casos; no publicar `daily` sin el mismo umbral o redondear.

### A-05 (Medio, CONFIRMADO) Carrera: la IA y Deepgram se gastan sin cobrar
- Archivo: `apps/api/src/modules/agent/service.ts:89-94,101-117,140`, `agent/intake.ts:16-19`.
- Qué pasa: el saldo se comprueba (`assertCanAfford`) antes de llamar a DeepSeek/Deepgram y el cobro atómico ocurre después. Peticiones simultáneas pasan todas la comprobación; solo una cobra, las demás reciben 402 después de haber consumido IA. Además, si el modelo falla o no hay `DEEPSEEK_API_KEY`, el análisis se guarda y se crea el caso sin cobrar (`aiUsed=false`), incluyendo indicadores de reputación gratis.
- Explotación: usuario con 1 crédito lanza 15 análisis en paralelo.
- Evidencia: `D parallel analyze with balance=1: statuses 200,402,402,...(14) | LLM calls made: 5` (5 llamadas al modelo por 1 crédito; el pool local limitó la concurrencia). El mismo patrón existe en `reports/service.ts:62-90` (llama a `narrate` antes de `spend`) y en `POST /api/reports` sin límite propio.
- Corrección: descontar primero dentro de la transacción y devolver con `grant(..., 'refund:'+ref)` si falla la IA; o tomar `pg_advisory_xact_lock(userId)` durante todo el análisis. Añadir `hit()` a `POST /reports` y a `GET /reports/:id/pdf`.

### A-06 (Medio, CONFIRMADO) El libro "inmutable" solo es tan inmutable como el rol de la base de datos
- Archivo: `apps/api/drizzle/0003_ledger_append_only.sql`, `apps/api/src/modules/reports/ledger.ts`.
- Qué pasa: los triggers bloquean `UPDATE`/`DELETE` fila por fila (verificado), pero: (a) `TRUNCATE` no está bloqueado; (b) la aplicación se conecta como `parcero`, dueño de las tablas y superusuario (en el entorno local), por lo que cualquier inyección SQL futura o credencial filtrada puede `ALTER TABLE ... DISABLE TRIGGER` y reescribir; (c) la cadena no está anclada fuera de la BD: quien controle la BD puede recalcular toda la cadena de forma consistente y la página pública mostraría "VERIFICADO", porque `verifyReport` se recalcula con los mismos datos guardados.
- Evidencia:
  ```
  DB UPDATE ledger_entries ...  bloqueado: ledger_entries es de solo anexar
  DB DELETE FROM reports        bloqueado: reports es inmutable
  DB TRUNCATE ledger_entries CASCADE  OK(permitido)
  owner parcero current {"current_user":"parcero","su":true}
  ```
- Qué no es un problema: con acceso solo a la aplicación (sin SQL) no hay ruta para editar reportes; las carreras al añadir se serializan con `pg_advisory_xact_lock`; la canonicalización es determinista.
- Corrección mínima: (1) trigger `BEFORE TRUNCATE ... FOR EACH STATEMENT`; (2) en producción conectar con un rol sin ser dueño ni superusuario, con solo `SELECT, INSERT` sobre `ledger_entries` y `reports`; (3) publicar periódicamente `headHash` en un lugar externo (la etapa 2 de anclaje del plan); (4) en el pitch decir "detecta alteraciones" y no "imposible de alterar".

### A-07 (Medio, PLAUSIBLE) DoS barato en endpoints públicos o caros: verificación de cadena y OCR
- `reports/ledger.ts:61-88`: cada `GET /api/verify/:code` y `/certificado/:code` (públicos) carga **toda** la tabla `ledger_entries` y recalcula todos los hashes. Con miles de reportes cuesta cientos de ms y mucha memoria por petición; el límite es 60/min por IP (falsificable con A-02), y cada petición escribe en `rate_limits`. Corrección: verificar solo el tramo necesario o cachear `headHash` y el resultado de la verificación completa por unos minutos.
- `gateways/ocr.ts:25-33` y `agent/intake.ts:35-48`: cola de OCR sin tope, un solo worker; la imagen solo se valida por magic bytes (no dimensiones: una imagen pequeña que expande a decenas de megapíxeles consume memoria y CPU). 10/min por usuario y cuentas gratis. Corrección: limitar la cola (rechazar con 503 si hay más de N pendientes), validar ancho/alto con la cabecera PNG/JPEG antes de OCR y tiempo máximo por imagen.
- No lo ejecuté (sin pruebas de carga, por instrucción).

### A-08 (Medio, CONFIRMADO en código) Privacidad: filtro de datos personales incompleto y fallo abierto del moderador
- Archivo: `apps/api/src/modules/feed/service.ts:11-18,31-45`; `modules/agent/service.ts:132-135` (guarda `inputText` crudo).
- Qué pasa: `redactPersonalData` no cubre cédulas con puntos, cuentas con guiones ni teléfonos con paréntesis. Si el moderador (DeepSeek) falla o no hay clave, el texto se publica igual (hay un comentario `ponytail` que lo reconoce). El texto del usuario puede intentar manipular al moderador (el cierre `TEXTO>>>` es imitable), y no se quitan URLs: el feed puede servir para difundir enlaces de phishing a otros usuarios.
- Evidencia: entrada `Mi cédula 1.020.345.678, cel 300 000 0001, mail a@b.co, cuenta 12-345-678901, +57 (314) 617-8719, visita http://phish.example/x`; salida: el correo y el celular simple se enmascaran, pero `1.020.345.678`, `12-345-678901`, `+57 (314) 617-8719` y la URL pasan intactos.
- Habeas Data: `cases.input_text` guarda el mensaje completo (con números, nombres) sin límite de retención ni vía de borrado; `wa_messages` y `bot_state` guardan números. Documentar finalidad y retención; ofrecer borrado de cuenta.
- Corrección: quitar puntos/guiones/espacios antes de buscar secuencias de 7+ dígitos; reemplazar URLs por `[enlace]` en el feed (o mostrarlas no clicables); si el moderador falla, rechazar la publicación en lugar de publicar; añadir TTL a `cases.input_text`.

### A-09 (Bajo, CONFIRMADO) Enumeración de celulares registrados en `register`
- `auth/service.ts:59`: responde 409 `phone_taken` si el celular ya está verificado, mientras `resend-code` evita esa enumeración a propósito. Evidencia: `G register on verified phone -> 409 phone_taken` vs `202` para uno nuevo. Además, registrar el celular de un tercero le envía un código de WhatsApp no solicitado (acotado a 1 cada 10 min y 5 al día por celular).
- Corrección: responder siempre 202 con la respuesta genérica y, si el celular ya existe y está verificado, no enviar nada.

### A-10 (Bajo, CONFIRMADO en código) Fuerza bruta de login distribuida
- `auth/service.ts:99`: el límite es por `ip:phone` (10 en 10 min). Un atacante con varias IPs o con A-02 prueba contraseñas sin límite global sobre un celular. Corrección: añadir un contador `login:phone:${phone}` (p. ej. 30 por hora) además del de IP; no bloquear la cuenta del todo para no permitir bloqueos por terceros.

### A-11 (Bajo, CONFIRMADO en código) No se manejan reembolsos ni contracargos
- `credits/service.ts:57-87`: si la compra ya está `approved`, cualquier aviso posterior (`refunded`, `charged_back`) devuelve `approved` y no se descuentan los créditos. Un usuario puede comprar, gastar los créditos y pedir el contracargo. Corrección: al recibir estado `refunded`/`charged_back` de una compra aprobada, registrar un movimiento negativo con ref `refund:${payment.id}` (permitiendo saldo negativo o bloqueando la cuenta) y marcar la compra.

### A-12 (Bajo, CONFIRMADO en código) Lista blanca de dominios de medios de WhatsApp débil
- `gateways/whatsapp.ts:121`: `/^https:\/\/[\w.-]*(fbcdn\.net|facebook\.com|whatsapp\.net)\//` acepta `https://evilfbcdn.net/` o `https://evil-facebook.com/`; a ese destino se envía el `Authorization: Bearer` del token de WhatsApp. La URL la devuelve la Graph API de Meta (no el usuario), por lo que requiere comprometer esa respuesta. Además el tope de 6 MB se verifica después de descargar todo el cuerpo. Corrección: `new URL(url).hostname` y comparar con `endsWith('.fbcdn.net')`, `=== 'lookaside.fbsbx.com'` etc.; no reenviar el token a hosts que no sean de Meta; leer en streaming con tope.

### A-13 (Bajo, CONFIRMADO en código) Separación de claves y sesión sin revocación
- `JWT_SECRET` se reutiliza para firmar la sesión, el HMAC de los OTP (`auth/service.ts:24`) y el hash de reputación (`agent/service.ts:36`, `lookup/service.ts:30`). Rotar el secreto invalida sesiones, OTP y toda la reputación guardada; una filtración del secreto compromete todo. Usar tres claves derivadas (`HKDF(JWT_SECRET, 'otp')`, etc.).
- `logout` solo borra la cookie: un JWT robado sirve 7 días. Aceptable para el MVP; añadir `sessionVersion` en `users` si se quiere revocar.

### A-14 (Bajo, CONFIRMADO en código) Valores por defecto inseguros en `config.ts` y registro de URLs
- `config.ts:8`: `DATABASE_URL` cae a las credenciales de desarrollo si falta la variable, también en producción. `WEB_ORIGIN` y `PUBLIC_BASE_URL` caen a `localhost`. Hacer que `loadConfig` falle en `NODE_ENV=production` si faltan `DATABASE_URL`, `WEB_ORIGIN`, `PUBLIC_BASE_URL` y `WHATSAPP_APP_SECRET`/`MERCADOPAGO_WEBHOOK_SECRET` si el bot/pagos están activos.
- El logger de Fastify (`server.ts:47`) solo redacta cookie y authorization; la URL completa se registra, incluyendo `hub.verify_token` y `payment_id`. Añadir `req.url` redactado para `/api/webhooks/*` o cambiar el serializador.

### A-15 (Bajo, CONFIRMADO) Audio sin validación de tipo
- `agent/routes.ts:17-24`: el audio se reenvía a Deepgram con el `Content-Type` del cliente, sin comprobar magic bytes ni duración; hasta 6 MB, 10/min por usuario, cada uno 1 llamada pagada. Verificar cabecera (webm/ogg/wav/mp4) y limitar a ~60 s; es el mismo vector de coste que A-05.

---

## Informativo
- **I-01** Certificado: la verificación prueba integridad, no veracidad. El `receivedText`, `details` y el monto los escribe el propio usuario; el PDF y el certificado "VERIFICADO" pueden respaldar un relato inventado. El PDF ya dice que es soporte y no denuncia; mantener esa frase visible en la página de verificación.
- **I-02** `.env` no está en el repo y `.gitignore` lo cubre (`.env`, `.env.*`, `node_modules`, `dist`). El `.env` local contiene `MERCADOPAGO_ACCESS_TOKEN` de producción según `CLAUDE.md`; mantenerlo fuera de cualquier imagen/artefacto. `.env.*` también ignora un futuro `.env.example`; añadir `!.env.example`.
- **I-03** `WHATSAPP_APP_SECRET` no está en el `.env` actual (solo vi nombres): el webhook de WhatsApp responde 503 hasta que se configure. Falla cerrado (correcto), pero el bot no funcionará en la demo sin esa variable.
- **I-04** Cabeceras: `@fastify/helmet` en la API (HSTS, nosniff, frame, CSP por defecto; la página `/certificado` usa solo estilos en línea y funciona con esa CSP). La PWA estática no define cabeceras en el repo (depende del hosting): añadir CSP, `X-Content-Type-Options`, `Referrer-Policy` y `Permissions-Policy` (micrófono=self) en el host. No hay CORS (mismo origen mediante proxy); correcto.
- **I-05** Compras: cada usuario nuevo recibe 200 créditos gratis; el único freno al abuso es controlar números de WhatsApp. Es una decisión de producto; vigilar la creación masiva de cuentas.
- **I-06** Service Worker: `runtimeCaching: []`, `navigateFallbackDenylist` incluye `/api` y `/certificado`; no se cachean datos sensibles. Correcto.

## npm audit (resultado literal)

`npm audit` en `apps/api`:
```
# npm audit report

esbuild  <=0.24.2
Severity: moderate
esbuild enables any website to send any requests to the development server and read the response - https://github.com/advisories/GHSA-67mh-4wv8-2f99
fix available via `npm audit fix --force`
Will install drizzle-kit@0.18.1, which is a breaking change
node_modules/@esbuild-kit/core-utils/node_modules/esbuild
  @esbuild-kit/core-utils  *
  Depends on vulnerable versions of esbuild
  node_modules/@esbuild-kit/core-utils
    @esbuild-kit/esm-loader  *
    Depends on vulnerable versions of @esbuild-kit/core-utils
    node_modules/@esbuild-kit/esm-loader
      drizzle-kit  0.19.0 - 1.0.0-beta.1-fd8bfcc
      Depends on vulnerable versions of @esbuild-kit/esm-loader
      node_modules/drizzle-kit

4 moderate severity vulnerabilities
```

`npm audit` en `apps/web` (resumen literal de la cabecera y totales; el informe completo coincide con lo siguiente):
```
@vitest/mocker  <=4.1.11   Severity: moderate  (Path Traversal / Arbitrary File Read; Code injection) -> vitest@5.0.5 (breaking)
braces  *                  Severity: high      (stack-exhaustion DoS GHSA-vfj7-8cjw-p6xm) via chokidar/tailwindcss
esbuild  <=0.24.2          Severity: moderate  (GHSA-67mh-4wv8-2f99, servidor de desarrollo) via vite
postcss-selector-parser <7.1.6  moderate (GHSA-rj75-hqrm-r3gf, CPU) via tailwindcss
react-router  6.0.0 - 7.17.0    moderate (GHSA-wrjc-x8rr-h8h6 open redirect por backslash en <Link>/useNavigate; GHSA-337j-9hxr-rhxg SSR deserializeErrors) -> react-router-dom@7.18.4 (breaking)
tinypool  <=2.1.1          Severity: critical  (Prototype pollution -> RCE, GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr) via vitest

15 vulnerabilities (7 moderate, 6 high, 2 critical)
```

`npm audit --omit=dev` (lo que se envía a producción):
```
react-router  6.0.0 - 7.17.0
Severity: moderate
React Router: Open redirect via backslash in <Link> and useNavigate (CVE-2025-68470 bypass) - https://github.com/advisories/GHSA-wrjc-x8rr-h8h6
React Router: Arbitrary Constructor Injection via deserializeErrors() in React Router SSR Hydration - https://github.com/advisories/GHSA-337j-9hxr-rhxg
2 moderate severity vulnerabilities
```

Análisis de alcance: los dos "critical" y los "high" están todos en herramientas de desarrollo y pruebas (`vitest`, `tinypool`, `tailwindcss`/`braces`, `vite`/`esbuild`, `drizzle-kit`): no se empaquetan en producción ni se ejecutan con entrada de usuarios. Lo único que llega al navegador es `react-router`. No es alcanzable aquí: la app no usa SSR (`deserializeErrors` no aplica) y todos los `Navigate`/`Link` usan rutas fijas; el único destino dinámico, `window.location.assign(url)` en `Credits.tsx:59`, recibe la URL de Mercado Pago desde la API, no de la entrada. Aun así conviene subir a `react-router-dom@6.30.x` más reciente o a 7.18 cuando haya tiempo. Para el servidor, `drizzle-kit` solo corre en generación de migraciones.

## Revisado sin hallazgos
- **IDOR y control de acceso (ejecutado):** un segundo usuario recibe 404 al pedir `POST /api/reports` con el `caseId` de otro y 404 al pedir el PDF de otro; sin sesión da 401. Matriz sin sesión (`/posts`, `/credits`, `/lookup`, `/reports`, `/voice/speak`, `/analyze`) devuelve 401. `feed.remove` filtra por `userId`. Rutas realmente públicas: `/api/verify/:code`, `/certificado/:code`, `/api/territory*`, `/api/locations*`, `/api/health`, `/api/credits/return` y los dos webhooks.
- **Datos públicos:** `/api/verify/:code` devuelve solo `code,type,typeLabel,issuedAt,location,verification` (sin nombre, relato ni números). Códigos de 10 símbolos de un alfabeto de 30 (~5.9e14): no enumerables, con límite adicional por IP.
- **SQL:** todo pasa por Drizzle o plantillas `sql` con parámetros enlazados; LIKE de municipios escapa `\ % _`; no se concatena entrada del usuario en SQL.
- **XSS:** la página `certificatePage.ts` escapa todo valor dinámico con `esc()` (nombre del reportero no aparece); frontend sin `dangerouslySetInnerHTML`, `innerHTML` ni `bindPopup` con datos del usuario; el único `href` dinámico es `/certificado/${code}` con el código ya validado por regex. PDF con `pdfkit` (texto plano, sin HTML); `Content-Disposition` usa el código validado.
- **Autenticación:** scrypt N=2^15 con sal por usuario y comparación en tiempo constante; verificación ficticia cuando el usuario no existe; JWT HS256 con algoritmo fijado y expiración; cookie `httpOnly`, `SameSite=Lax`, `Secure` en producción; OTP de 6 dígitos con `randomInt`, HMAC, 5 intentos con `FOR UPDATE`, un solo uso, expiración 10 min, límites por IP, celular y día en Postgres (compartidos entre instancias); CSRF por Origin (evil origin -> 403; la ausencia de Origin se admite y se apoya en `SameSite=Lax`, aceptable).
- **Pagos:** firma `x-signature` validada con el SDK oficial y tolerancia de 300 s; no se confía en el cuerpo, se consulta el pago a Mercado Pago; la compra y el usuario salen de la BD (`external_reference`), se comprueba monto y moneda exactos; `FOR UPDATE` en la compra e índice único `credit_ledger.ref` y `purchases.mp_payment_id` (sin doble crédito); `spend` atómico con `balance >= amount` (sin saldo negativo); `GET /credits/return` redirige siempre a `WEB_ORIGIN` fijo (no hay open redirect) y solo dispara una consulta idempotente; no hay SSRF: todos los hosts salientes son constantes y el dominio del usuario solo va codificado en la ruta de RDAP.
- **Webhook de WhatsApp:** firma `X-Hub-Signature-256` con `timingSafeEqual` sobre el cuerpo crudo; verify token; filtro por `phone_number_id`; deduplicación por id de mensaje; remitente solo se conoce por la firma de Meta (no suplantable sin el App Secret); límites por usuario (20/min) y por número sin cuenta (2/h); respuesta de error de IA sin filtrar internals. Los costos por mensaje quedan acotados por créditos y límites (salvo A-05).
- **Prompt injection:** el prompt marca el texto como dato no confiable y la respuesta se valida con zod estricto; las reglas deterministas solo pueden subir el riesgo, no bajarlo, y el veredicto solo afecta al propio usuario (el riesgo que sí afecta a otros es A-03). El moderador sí es manipulable en teoría (A-08).
- **Errores:** el manejador global nunca devuelve stack ni mensajes internos (JSON malformado -> 400 genérico); 500 con mensaje fijo.
- **Tamaños:** `bodyLimit` 1 MB general y 6 MB para audio e imagen; texto 4000/600 caracteres; validación zod en todas las rutas.
- **Docker:** el Postgres de desarrollo escucha solo en `127.0.0.1:15432`, con credenciales de desarrollo y no de producción.
- **Frontend/PWA:** sin tokens en `localStorage`; solo `sessionStorage` para el texto compartido; Service Worker sin caché de `/api`.

## No pude verificar
- Producción: no hay despliegue; no revisé TLS, cabeceras reales del hosting ni cuántos saltos de proxy hay (clave para A-02).
- Comportamiento real de DeepSeek (moderación, prompt injection) y de Mercado Pago/WhatsApp/Deepgram: todo se probó con simulaciones.
- El rol de base de datos que se usará en la nube (A-06); el que probé es el de desarrollo.
- Rendimiento bajo carga (A-07) por instrucción; OCR real con imágenes patológicas.
- Historial git: no existe, así que no pude buscar secretos en commits anteriores.

---

## Estado de las correcciones (22-oct-2026, después de la auditoría)

Todas verificadas con pruebas de regresión en `apps/api/test/security.test.ts` (115 pruebas del backend pasan).

| ID | Estado | Qué se hizo |
|----|--------|-------------|
| A-01 | **Corregido** | Los límites de código se aplican antes de escribir; datos nuevos + invalidar código + crear código van en una sola transacción. Prueba: el atacante recibe 429 y la víctima conserva su contraseña. |
| A-02 | **Corregido** | `TRUST_PROXY` ahora es un número de saltos (por defecto 0; Cloud Run = 1) y se usa una función `hop < N`. `true` se rechaza al arrancar. Prueba: `X-Forwarded-For` falso no evita el límite. |
| A-03 | **Corregido** | Los indicadores solo se guardan con evidencia objetiva (dominio imitador/TLD riesgoso/IP/acortador, lista de phishing o dominio joven; celulares solo con riesgo alto y reglas activadas). Prueba: 3 cuentas no pueden marcar un sitio inocente. |
| A-04 | **Corregido** | Una celda se publica solo con ≥ 3 **personas** distintas; totales, tipos y días se calculan solo con celdas visibles (sin deducción por resta). |
| A-05 | **Corregido** | El cobro va primero (atómico) y se reembolsa si falla la IA/STT/OCR/narración. Prueba: 15 análisis en paralelo con 1 crédito = 1 llamada a la IA. Se añadieron límites a crear reporte y descargar PDF. |
| A-06 | **Parcial** | Añadido trigger contra `TRUNCATE`. **Pendiente en producción**: conectar con un rol sin ser dueño ni superusuario y anclar `headHash` fuera de la BD. En el pitch: "detecta alteraciones", no "imposible de alterar". |
| A-07 | **Parcial** | Cola de OCR acotada (503 si hay 20 en espera). **Sigue**: la verificación pública recorre toda la cadena (O(n)); aceptable para el volumen del MVP, con límite 60/min por IP. |
| A-08 | **Corregido** | Redacción de cédulas/cuentas/teléfonos con separadores, enlaces mostrados solo como dominio; el moderador de IA **falla cerrado** (sin moderación no se publica). **Pendiente**: retención de `cases.input_text` y borrado de cuenta (Habeas Data). |
| A-09 | **Aceptado** | Se mantiene el 409 en el registro de un celular ya verificado por usabilidad (red social con login); el reenvío de código sí es genérico. |
| A-10 | **Corregido** | Tope adicional de 30 intentos de login por hora por celular. |
| A-11 | **Pendiente** | Reembolsos y contracargos de Mercado Pago no descuentan créditos. Documentado; no entra al MVP. |
| A-12 | **Corregido** | Comparación del nombre de host completo (`.fbcdn.net`, `.fbsbx.com`, `.whatsapp.net`) y solo `https`. |
| A-13 | **Parcial** | Subclaves derivadas de `JWT_SECRET` para OTP y huellas de reputación. La sesión sigue sin revocación individual (7 días). |
| A-14 | **Corregido** | En producción `DATABASE_URL`, `WEB_ORIGIN` y `PUBLIC_BASE_URL` son obligatorias; los logs ya no incluyen la query (tokens). |
| A-15 | **Pendiente** | Validación de cabecera/duración del audio; mitigado por cobro previo y límite 10/min. |
| I-02 | **Corregido** | `.gitignore` conserva `.env.example`. |
