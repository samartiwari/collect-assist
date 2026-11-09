/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API_PORT = process.env.PORT ?? '3001';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'CollectAssist',
        short_name: 'CollectAssist',
        description: 'Prioritised field collections for Company A',
        theme_color: '#14532d',
        background_color: '#f7f6f2',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // App shell is cached so the officer can reopen the app with no signal.
        // API data is cached by the app itself in IndexedDB, not by the service worker.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg}'],
      },
    }),
  ],
  server: {
    port: 5173,
    // changeOrigin stays false so the API's same-origin check sees the browser's Host.
    proxy: { '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
