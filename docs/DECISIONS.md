# Decisiones de arquitectura

Fuente de buenas prácticas: skills de ECC (affaan-m/ECC) — `postgres-patterns`, `database-migrations`, `backend-patterns`, `security-review`, `hexagonal-architecture`, `api-design`, `tdd-workflow`, `e2e-testing`.

| # | Decisión | Alternativas | Motivo |
|---|----------|--------------|--------|
| 1 | Monolito modular por funcionalidad (`modules/<feature>`: routes delgadas → service → repo). Puertos solo para servicios externos (WhatsApp, DeepSeek, Deepgram, Mercado Pago). | Hexagonal completa; MVC plano | Regla de no sobreingeniería; los puertos externos permiten simularlos en pruebas y en la carga de 50.000 VU. |
| 2 | Drizzle ORM + migraciones SQL generadas, forward-only | Kysely; SQL directo | Esquema tipado, transacciones y SQL crudo cuando hace falta (`FOR UPDATE`). |
| 3 | JWT en cookie httpOnly + SameSite=Lax + verificación de Origin | Sesiones en Postgres | ECC desaconseja localStorage; sin consulta a BD por petición (mejor para carga). |
| 4 | Tailwind CSS | CSS plano | Interfaz móvil consistente y rápida. |
| 5 | Rate limit sensible en Postgres (ventana fija atómica) | Redis; memoria | ECC: no usar contadores en memoria en producción; Redis añadiría costo y complejidad. El límite general por IP sí es en memoria (`ponytail`). |
| 6 | Contraseñas con scrypt de `node:crypto` (N=2^15) | argon2, bcrypt | Sin dependencias nativas; parámetros OWASP. |
| 7 | OTP de 6 dígitos guardado como HMAC, expira en 10 min, 5 intentos, un solo uso | — | Un código de 6 dígitos tiene poca entropía: se compensa con intentos limitados y rate limit. |
| 8 | Créditos: libro inmutable (`credit_ledger`, `ref` único = idempotencia) + saldo (`credit_accounts`, CHECK ≥ 0). `spend` hace `UPDATE … WHERE balance >= n` | Solo saldo | Auditable, idempotente ante reintentos del webhook de Mercado Pago, sin saldo negativo bajo concurrencia (probado). |
| 9 | Postgres en Docker en el puerto 15432 | 5432 | 5432 y 55432 ocupados por otros proyectos del usuario. |
| 10 | Verificación por WhatsApp con plantilla AUTHENTICATION (de pago) | Verificación inversa gratuita | Decisión explícita del usuario. |
