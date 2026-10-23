import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

const DIST = fileURLToPath(new URL('../../../web/dist', import.meta.url))

// En producción la API sirve también la PWA compilada: un solo contenedor y un solo origen
// (la cookie de sesión no necesita CORS). En desarrollo la PWA corre aparte con Vite y esto no hace nada.
export async function webAppPlugin(app: FastifyInstance) {
  if (!existsSync(DIST)) return

  await app.register(fastifyStatic, {
    root: DIST,
    wildcard: false,
    // El service worker y el manifiesto nunca se cachean a ciegas: así una versión nueva se actualiza al instante.
    setHeaders: (res, path) => {
      if (/(sw\.js|manifest\.webmanifest|index\.html)$/.test(path)) res.header('Cache-Control', 'no-cache')
      else if (/\/assets\//.test(path)) res.header('Cache-Control', 'public, max-age=31536000, immutable')
    },
  })

  // Rutas de la app de una sola página: cualquier GET que no sea API ni certificado devuelve index.html.
  app.setNotFoundHandler((req, reply) => {
    const isPage = req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/certificado')
    if (isPage) return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
    return reply.code(404).send({ error: 'not_found', message: 'No encontrado' })
  })
}
