// Página pública de verificación, renderizada en el servidor: sin JavaScript, sin dependencias del frontend.
// Todo valor dinámico pasa por esc() antes de entrar al HTML.
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

type Cert = {
  code: string
  typeLabel: string
  issuedAt: string
  location: string
  verification: {
    valid: boolean
    idx: number
    entryHash: string
    prevHash: string
    payloadHash: string
    recordedAt: string
    headHash: string
    totalEntries: number
    problem?: string
  }
}

const shell = (title: string, body: string) => `<!doctype html>
<html lang="es-CO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · La Segura</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111;--mut:#555;--line:#111}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#f2f2f2;--mut:#aaa;--line:#f2f2f2}}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.5 Georgia,'Times New Roman',serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.4rem;margin:.2em 0 .6em;border-bottom:2px solid var(--line);padding-bottom:.4em}
.stamp{border:2px solid var(--line);padding:14px 16px;margin:16px 0;font-weight:bold;font-size:1.15rem}
dl{margin:0}dt{font-weight:bold;margin-top:.9em}dd{margin:0;color:var(--fg)}
code{font:12.5px/1.4 Consolas,monospace;word-break:break-all;display:block}
small{color:var(--mut)}
.brand{display:flex;align-items:center;gap:10px;font-weight:bold;font-size:1.05rem}
.brand img{filter:grayscale(1) contrast(1.2)}
</style></head><body><main><p class="brand"><img src="/logo.png" width="36" height="36" alt="">La Segura</p>${body}</main></body></html>`

export function certificatePage(c: Cert): string {
  const v = c.verification
  return shell(
    `Certificado ${c.code}`,
    `<small>LA SEGURA</small><h1>Certificado de reporte</h1>
<div class="stamp">${v.valid ? '✔ VERIFICADO: este registro no ha sido alterado' : '✖ NO VÁLIDO: ' + esc(v.problem ?? 'el registro no coincide')}</div>
<dl>
<dt>Código</dt><dd>${esc(c.code)}</dd>
<dt>Tipo de reporte</dt><dd>${esc(c.typeLabel)}</dd>
<dt>Ubicación</dt><dd>${esc(c.location)}</dd>
<dt>Generado</dt><dd>${esc(c.issuedAt)}</dd>
<dt>Registro N.º</dt><dd>${v.idx} de ${v.totalEntries}</dd>
<dt>Huella del contenido (SHA-256)</dt><dd><code>${esc(v.payloadHash)}</code></dd>
<dt>Huella del registro (SHA-256)</dt><dd><code>${esc(v.entryHash)}</code></dd>
<dt>Huella del registro anterior</dt><dd><code>${esc(v.prevHash)}</code></dd>
<dt>Última huella de la cadena</dt><dd><code>${esc(v.headHash)}</code></dd>
</dl>
<p><small>Las huellas se recalcularon ahora mismo desde el contenido guardado y toda la cadena. Compara la huella del contenido con la impresa en tu PDF. Por privacidad esta página no muestra nombres, relatos ni números del caso.</small></p>`,
  )
}

export const notFoundPage = () =>
  shell('Certificado no encontrado', '<h1>Certificado no encontrado</h1><p>No existe un certificado con ese código. Revisa que esté bien escrito.</p>')
