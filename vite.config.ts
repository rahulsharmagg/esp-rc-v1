import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';
import fs from 'fs';
import path from 'path';

function firmwareDevServerPlugin() {
  return {
    name: 'firmware-dev-server',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;

        if (pathname === '/api/health') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ status: 'ok', dev: true, timestamp: new Date().toISOString() }));
          return;
        }

        if (pathname === '/api/firmware/latest') {
          const stablePath = path.resolve('firmware/stable.json');
          if (fs.existsSync(stablePath)) {
            res.writeHead(200, { 
              'Content-Type': 'application/json; charset=utf-8', 
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(fs.readFileSync(stablePath, 'utf8'));
            return;
          }
        }

        if (pathname === '/api/firmware/versions') {
          const espDir = path.resolve('firmware/esp32');
          if (fs.existsSync(espDir)) {
            const entries = fs.readdirSync(espDir, { withFileTypes: true });
            const versions: any[] = [];
            for (const entry of entries) {
              if (entry.isDirectory()) {
                const manifestPath = path.join(espDir, entry.name, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                  try {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    versions.push(manifest);
                  } catch {}
                }
              }
            }
            res.writeHead(200, { 
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ status: 'success', device: 'esp32-robot', count: versions.length, versions }, null, 2));
            return;
          }
        }

        const manifestMatch = pathname.match(/^\/api\/firmware\/([^\/]+)\/manifest$/);
        if (manifestMatch) {
          const version = manifestMatch[1];
          const manifestPath = path.resolve('firmware/esp32', version, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            res.writeHead(200, { 
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(fs.readFileSync(manifestPath, 'utf8'));
            return;
          }
        }

        const versionMatch = pathname.match(/^\/api\/firmware\/([^\/]+)$/);
        if (versionMatch && versionMatch[1] !== 'latest' && versionMatch[1] !== 'versions') {
          const version = versionMatch[1];
          const manifestPath = path.resolve('firmware/esp32', version, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            res.writeHead(200, { 
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(fs.readFileSync(manifestPath, 'utf8'));
            return;
          }
        }

        if (pathname.startsWith('/firmware/esp32/') && pathname.endsWith('/firmware.bin')) {
          const parts = pathname.split('/');
          const version = parts[3];
          const binPath = path.resolve('firmware/esp32', version, 'firmware.bin');
          if (fs.existsSync(binPath)) {
            const stat = fs.statSync(binPath);
            res.writeHead(200, { 
              'Content-Type': 'application/octet-stream',
              'Content-Length': stat.size,
              'Content-Disposition': `attachment; filename="firmware-${version}.bin"`,
              'Access-Control-Allow-Origin': '*'
            });
            fs.createReadStream(binPath).pipe(res);
            return;
          }
        }

        next();
      });
    }
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(`v${pkg.version}`),
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toLocaleDateString())
  },
  plugins: [
    svelte(),
    firmwareDevServerPlugin(),
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
        navigateFallbackDenylist: [/^\/api\//, /^\/firmware\//],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/firmware/'),
            handler: 'NetworkOnly'
          },
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
  optimizeDeps: {
    include: ['@lucide/svelte']
  },
  server: {
    host: true,
    port: 5173,
    https: false
  }
});
