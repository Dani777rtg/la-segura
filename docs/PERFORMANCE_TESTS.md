# Pruebas de rendimiento

**Conclusión honesta:** el objetivo era validar hasta **50.000 usuarios virtuales (VU) concurrentes**. **No se alcanzó.** El **máximo validado en un solo equipo fue ≈ 2.500 VU en el escenario mixto y en escritura, y 3.500 VU en lectura (con caché), con 0 % de errores.** No se afirma que el sistema soporte 50.000 VU: esa cifra no está medida.

Todas las pruebas fueron **locales, contra una base aislada y con servicios externos simulados**. **No se ejecutó ninguna prueba de carga contra producción ni contra servicios de terceros** (el script de k6 aborta si el destino no es `localhost`/`127.x`).

## Entorno
| | |
|---|---|
| Equipo | Intel Core i7-13620H, 16 hilos lógicos, 23,7 GB RAM, Windows 11 (el mismo equipo ejecuta k6, la API y Postgres) |
| Generador | k6 v2.2.0 (`loadtest/bin/k6.exe`) |
| API bajo prueba | `apps/api/src/loadtest-server.ts`: la misma app, con DeepSeek, Deepgram, WhatsApp, OCR, comprobaciones externas y Mercado Pago **simulados**; 4 procesos Node (127.0.0.1–4:3100); pool de 20 conexiones por proceso |
| Base de datos | Postgres 16 en Docker, BD **`parcero_load`** (nunca `parcero` ni `parcero_test`), 50.500 usuarios sintéticos y sesiones firmadas precalculadas |
| Reproducir | `loadtest/servers.sh start 4` y `TAG=... loadtest/ramp.sh <escenario> 4 10 <niveles…>` (ver `loadtest/`) |

**Diferencias con producción:** producción es Cloud Run (1 vCPU / 1 GiB por instancia, hasta 3) + Cloud SQL `db-f1-micro` (CPU compartida, ~0,6 GB RAM), con latencia de red real y TLS. Un `f1-micro` es **mucho menos potente** que el Postgres local de estas pruebas: los números de aquí **no se pueden trasladar** a producción. No se probó contra un entorno equivalente por costo y por la regla de no cargar producción.

## Qué significa "VU" aquí
Cada VU es una **sesión autenticada** (cookie firmada) que hace una acción y espera ~10 s (tiempo de pensar medio, como una persona leyendo). Por eso 2.500 VU ≈ 170 solicitudes/s, no 2.500/s. 50.000 VU con ese mismo patrón serían ≈ 5.000 solicitudes/s y ~50.000 conexiones simultáneas, lo que no cabe en una sola máquina de escritorio (ver límites).

## Escenarios
- **read**: `GET /api/territory` (mapa), `/territory/bogota-geojson`, autocompletado de municipios, `/health` (públicos).
- **auth**: `GET /api/auth/me`, `/api/credits` (sesión).
- **mix**: lecturas + sesión + feed + consulta antes de pagar.
- **write**: `POST /api/analyze` (cobro atómico de créditos + inserción del caso, IA simulada) y `POST /api/posts`.
- **credits**: ráfaga simultánea de gastos sobre el mismo usuario.

Criterios de aceptación **propuestos por el equipo de pruebas** (no son objetivos del producto): error < 1 %; p95 < 500 ms (lectura), < 600 ms (sesión), < 800 ms (mixto), < 1.000 ms (escritura).

## Resultados (rampa 60 s + 60 s sostenido por nivel, BD reiniciada entre niveles)
| Escenario | VU | Solic./s | p50 | p95 | p99 | Errores | CPU Postgres máx. | Cumple criterio |
|---|---|---|---|---|---|---|---|---|
| mix | 1.000 | 70 | 4 ms | 20 ms | 54 ms | 0 % | 31 % | Sí |
| mix | 1.500 | 104 | 5 ms | 33 ms | 439 ms | 0 % | 51 % | Sí |
| mix | 2.000 | 128 | 63 ms | 4.010 ms | 9.542 ms | 0 % | 73 % | **No** (cola de conexiones, `poolWait` 188) |
| mix | 2.500 | 171 | 56 ms | 886 ms | 1.903 ms | 0 % | 253 % | Casi (p95 > 800) |
| write | 1.000 | 70 | 15 ms | 24 ms | 30 ms | 0 % | 34 % | Sí |
| write | 2.500 | 174 | 28 ms | 49 ms | 324 ms | 0 % | 116 % | Sí |
| auth | 2.500 | 174 | 3 ms | 6 ms | 11 ms | 0 % | 29 % | Sí |
| read (sin caché) | 1.000 | 70 | 5 ms | 79 ms | 278 ms | 0 % | 44 % | Sí |
| read (sin caché) | 2.500 | 146 | 2.255 ms | 4.178 ms | 4.735 ms | 0 % | 218 % | **No** |
| read (sin caché) | 3.500 | 157 | 7.974 ms | 11.696 ms | 12.324 ms | 0 % | 221 % | **No** |
| **read (con caché)** | **2.500** | 174 | **3 ms** | **91 ms** | 453 ms | 0 % | **31 %** | **Sí** |
| **read (con caché)** | **3.500** | 242 | **3 ms** | 848 ms | 2.649 ms | 0 % | 56 % | Parcial (p95 > 500; el límite es el equipo) |

Cifras sin guion tomadas de `loadtest/results/summary-*.jsonl`.

## Cuello de botella encontrado y corregido
`GET /api/territory` (el mapa) hacía 5 agregaciones sobre toda la tabla de casos **en cada petición**: a 2.500 VU saturaba Postgres (218 % de CPU) y la latencia mediana subía a 2,2 s. **Corrección:** caché de 60 s con una sola consulta en vuelo (`TERRITORY_CACHE_SEC`, `modules/territory/service.ts`), con prueba automática. **Resultado medido:** a 2.500 VU, p50 2.255 ms → 3 ms, p95 4.178 ms → 91 ms y CPU de Postgres 218 % → 31 %. A 3.500 VU, p50 7.974 ms → 3 ms. Los datos del mapa pueden tener hasta 60 s de retraso (aceptable para un panel agregado y refuerza el anonimato).

## Integridad bajo concurrencia
Tras las pruebas se verificó por SQL sobre `parcero_load` (50.500 cuentas): **0 saldos negativos y 0 descuadres entre el libro (`credit_ledger`) y el saldo (`credit_accounts`)**. Además hay pruebas automáticas de gasto concurrente (`test/credits.test.ts`, `test/security.test.ts`: 15 análisis en paralelo con 1 crédito = 1 sola llamada a la IA).

## Limitaciones y por qué no se llegó a 50.000 VU
1. **El generador de carga y la API comparten la máquina.** A 3.500 VU k6 usa ~7,6 núcleos y 3,9 GB de RAM (de 16 hilos): el equipo, no la API, es el límite. El monitoreo muestra CPU del servidor de 18–39 % en esos puntos.
2. **Conexiones TCP:** Windows tiene un rango de puertos efímeros de ~16.000; con 4 direcciones de loopback se llegó a 7.221 conexiones simultáneas. 50.000 conexiones exigen varias máquinas generadoras.
3. **Login (scrypt, N=2^15) es intensivo en CPU** (~decenas de ms por intento): no se probó a gran escala; el techo de la API es la CPU, y por diseño hay límite de 10 intentos por IP/celular cada 10 min.
4. **Cloud SQL `db-f1-micro` no aguantaría estas cargas**: tiene una fracción de la CPU y la memoria de la base local. En producción el techo real estaría mucho más abajo; habría que subir el tamaño de la instancia y añadir réplicas de lectura/pgBouncer.
5. Los servicios externos reales (DeepSeek, Deepgram, WhatsApp, Mercado Pago) tienen sus propios límites de tasa y costos; se simularon.

## Para llegar a 50.000 VU (no hecho, solo recomendación)
Generadores distribuidos en un entorno **aislado y no productivo** (varias VMs de prueba con autorización y costo estimado previo), un entorno de carga equivalente a producción, `pgBouncer`/pool dimensionado, caché también para el feed y `/lookup`, y subir las instancias de Cloud Run. Nada de esto se creó ni se ejecutó.
