import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' force-reloads every open tab (via location.reload()) the moment
      // a new deploy's service worker is detected - with no user prompt. On an
      // operational tool this looks exactly like "the app closes itself" mid-use,
      // especially with frequent deploys. 'prompt' installs the new SW in the
      // background and only activates it on the next natural page load, so an open
      // session is never interrupted out of nowhere.
      registerType: 'prompt',
      manifest: {
        name: '4Client - Gestión Operativa',
        short_name: '4Client',
        theme_color: '#1A7A4A',
        background_color: '#F2F5F2',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': '/src' },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
