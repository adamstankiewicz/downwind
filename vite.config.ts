import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { DOCS } from './src/refs/catalog';

// In development, /api/awc/* is proxied to aviationweather.gov and
// /api/docs/<id> to the FAA handbook PDFs, so the browser never has to deal
// with CORS. In production the same paths are served by the edge worker in /worker.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Downwind Ground School',
        short_name: 'Downwind',
        description: 'Scenario-based ground school and flight review prep.',
        theme_color: '#f6f5f0',
        background_color: '#f6f5f0',
        display: 'standalone',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // .mjs too, so the PDF viewer's worker is on the device before the first handbook opens.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/awc/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'weather', expiration: { maxAgeSeconds: 6 * 60 * 60 } },
          },
          {
            // A handbook opened once stays readable offline.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/docs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'handbooks', expiration: { maxEntries: 20 }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api/awc': {
        target: 'https://aviationweather.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/awc/, '/api/data'),
      },
      '/api/docs': {
        target: 'https://www.faa.gov',
        changeOrigin: true,
        rewrite: (path) => DOCS[path.replace(/^\/api\/docs\//, '')]?.path ?? '/404',
      },
    },
  },
  test: { environment: 'node' },
});
