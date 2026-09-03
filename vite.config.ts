import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'fonts/*.woff2'],
      manifest: {
        name: 'Dominó Venezolano',
        short_name: 'Dominó',
        description: 'Dominó venezolano en parejas, en tiempo real, con tus panas.',
        lang: 'es-VE',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B1020',
        theme_color: '#0B1020',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        // La partida vive en Supabase (websocket + RPC): nunca se cachean sus respuestas.
        navigateFallbackDenylist: [/^\/auth/],
      },
    }),
  ],
  server: { host: true },
})
