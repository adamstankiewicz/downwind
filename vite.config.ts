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
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Downwind Ground School',
        short_name: 'Downwind',
        description: 'Scenario-based ground school and flight review prep.',
        theme_color: '#17242b',
        background_color: '#f3f5f4',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
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
