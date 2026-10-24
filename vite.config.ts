import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// In development, /api/awc/* is proxied to aviationweather.gov so the browser
// never has to deal with CORS. In production the same path is served by the
// edge worker in /worker.
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
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/awc/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'weather', expiration: { maxAgeSeconds: 6 * 60 * 60 } },
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
    },
  },
  test: { environment: 'node' },
});
