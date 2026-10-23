/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:3000', '/certificado': 'http://localhost:3000' } },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'logo.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'La Segura',
        short_name: 'La Segura',
        description: 'Revisa mensajes y enlaces sospechosos antes de caer en una estafa.',
        lang: 'es-CO',
        theme_color: '#ffffff',
        background_color: '#f0f2f5',
        display: 'standalone',
        start_url: '/app',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: {
          action: '/compartir', method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      } as never,
      workbox: {
        // Solo el shell estático; nunca /api ni cookies.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/certificado\//],
        runtimeCaching: [],
      },
    }),
  ],
});
