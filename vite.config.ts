import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(`v${pkg.version}`),
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toLocaleDateString())
  },
  plugins: [
    svelte(),
    // basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/icon.svg',
        'icons/ESP-RC-ICON.png',
        'ESP-RC-LOGO.svg',
        'ESP-RC-LOGO.png'
      ],
      manifest: {
        name: 'ESP-RC',
        short_name: 'ESP-RC',
        description: 'High-Performance Web Bluetooth & Wi-Fi RC Car Cockpit',
        theme_color: '#ffffff',
        background_color: '#f0f2f5',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone', 'window-controls-overlay'],
        orientation: 'landscape',
        start_url: './',
        icons: [
          {
            src: 'icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          },
          {
            src: 'icons/ESP-RC-ICON.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache'
            }
          },
          {
            urlPattern: ({ request }) => request.destination === 'image' || request.url.endsWith('.svg') || request.url.endsWith('.png'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    https: false
  }
});
