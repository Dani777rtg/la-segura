# Guion del pitch — Parcero Seguro (5 minutos)

**Frase de apertura:** *"En Bosa nadie debería perder sus ahorros por un mensaje que pudo verificar en diez segundos."*

URL de la demo: **https://ps-app-119015175009.us-central1.run.app** · WhatsApp del bot: **+57 302 403 6890**

## Línea de tiempo
| Min | Qué se dice y se muestra |
|---|---|
| 0:00–0:40 | **Problema.** La Policía atendió más de 13.000 incidentes cibernéticos en 2025 y hubo más de 64.000 denuncias por estafa digital en el país (Centro Cibernético). Lo más común en Colombia: suplantación de bancos y billeteras (Nequi, Bancolombia), robo de WhatsApp, tiendas y préstamos falsos ("gota a gota digital"). La víctima no sabe si el mensaje es falso, no sabe cómo denunciar y nadie ve el patrón del barrio. *No hay cifras públicas por localidad: por eso el panel muestra datos de demostración rotulados.* |
| 0:40–1:00 | **Solución.** Parcero Seguro es el vecino digital que te cuida **antes** de pagar: un agente de IA por voz, texto o WhatsApp, verificación con fuentes abiertas, un reporte que sirve para denunciar y un mapa de patrones del territorio. |
| 1:00–2:30 | **Demo en vivo** (guion abajo). |
| 2:30–3:15 | **Confianza y transparencia.** Cada reporte queda en una cadena de hashes de solo anexar con certificado y QR: se puede verificar sin confiar en nosotros y cualquier alteración se detecta. El bot es honesto: no inventa porcentajes, usa niveles en palabras apoyados en evidencia ("muy probable", "probablemente", "podría ser", "poco probable"), marca lo simulado y nunca dice "es seguro". |
| 3:15–4:15 | **Impacto esperado en Bosa y viabilidad.** Ver abajo. |
| 4:15–4:45 | **Modelo y costos.** 200 créditos gratis por persona; paquete de 1.000 por $49.000 + IVA con Mercado Pago. Infra de bajo costo (Cloud Run escala a cero). |
| 4:45–5:00 | **Cierre.** *"Verificar antes de pagar tiene que ser tan fácil como mandar un WhatsApp."* |

## Demo en vivo (90 s) — en este orden
1. **WhatsApp** (o WhatsApp Web proyectado): mandar al bot *"Bancolombia: tu cuenta será bloqueada hoy. Ingresa a https://bancolombia-seguro.xyz y confirma tu clave dinámica."* → 🔴 "Muy probable que sea una estafa", consejos cortos y dos ofertas: reporte en PDF y **PUBLICAR** una alerta anónima para los vecinos.
2. Responder **"PUBLICAR"** → la alerta aparece en Comunidad como "Un vecino". Luego **"Sí"** → llega el **PDF** (blanco y negro, de documento oficial).
3. En el **celular con la PWA**: abrir el PDF/certificado → escanear el **QR** → página "VERIFICADO".
4. **Consulta antes de pagar:** buscar el número del mensaje → alerta de la comunidad.
5. **Mapa:** Colombia y Bogotá por localidad (Bosa resaltada), aviso "incluye datos de demostración".
6. (Si hay tiempo) **Voz:** tocar el micrófono y contar el caso hablando.

*Plan B si falla internet o WhatsApp:* mostrar la PWA (texto + voz), el PDF ya generado y el certificado.

## Impacto esperado en Bosa (sin inventar cifras)
- **Prevenir antes que denunciar:** la persona verifica en segundos, por el canal que ya usa (WhatsApp), con voz para quien lee poco.
- **Denuncia más fácil y con soporte:** el PDF reúne relato, evidencia y la ruta (banco, ADenunciar, CAI Virtual, Fiscalía). *Es un soporte, no la denuncia legal.*
- **Inteligencia territorial:** el mapa agregado y anónimo le muestra a la comunidad y a las autoridades dónde y cómo golpean las estafas.
- **Métricas de éxito propuestas para el piloto:** casos analizados antes de pagar, reportes generados, tiempo entre el intento y la alerta, localidades con más reportes. Sin metas inventadas: se miden en el piloto.

## Viabilidad con los actores de la localidad
- **Juntas de Acción Comunal y líderes** como promotores digitales (modo asistido para quien no tiene smartphone).
- **Alcaldía Local de Bosa y Policía (CAI Virtual / ADenunciar)**: usarían el panel territorial y recibirían reportes mejor documentados.
- **Bancos y billeteras:** canal de alertas de suplantación y reclamos con número de radicado.
- **Tenderos, comerciantes y colegios:** puntos de difusión y capacitación.
- **Sostenibilidad:** créditos para quien los necesite; convenios institucionales a futuro.

## Preguntas probables del jurado
- **¿El PDF es una denuncia?** No: es un soporte organizado y verificable para llevar a banco, ADenunciar o Fiscalía. No existe API pública para radicarla por la persona.
- **¿La consulta a Policía/Fiscalía es real?** Es una **simulación rotulada** (no hay API pública); sí usamos fuentes abiertas reales (lista de phishing, edad del dominio) y la reputación de la comunidad.
- **¿Es inmutable?** Cadena de hashes con triggers de solo anexar y verificación pública; **detecta alteraciones**. Fortaleza futura: anclar la huella en una blockchain pública.
- **¿Privacidad?** Mapa agregado con mínimo de 3 personas por celda; los números se guardan con HMAC; el feed oculta datos personales; no se piden cédulas.
- **¿Escala?** En un solo equipo validamos 2.500 usuarios concurrentes mixtos con 0 % de errores y encontramos y corregimos un cuello de botella; **no** medimos 50.000 (ver `docs/PERFORMANCE_TESTS.md`).
- **¿Seguridad?** Auditoría independiente: 0 críticos, 2 altos corregidos, el resto con pruebas de regresión (`docs/SECURITY_AUDIT.md`).
- **¿Y si la IA se equivoca?** Las reglas objetivas solo pueden subir el riesgo, nunca bajarlo; el bot dice su nivel en palabras (nunca un porcentaje inventado) y pide verificar por el canal oficial.

## Fuentes citadas
- Cibercrimen en Colombia 2025 (13.000 incidentes): El País Cali. · Denuncias por estafa digital 2025 (>64.000): Portafolio. · Falso Nequi y modalidades: Semana, Infobae, Publimetro. *Verificar enlaces y cifras antes de presentar.*
