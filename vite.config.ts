import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ClipSync',
        short_name: 'ClipSync',
        description: 'Clipboard manager + AI assistant + Deep research hub',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: './',
        start_url: './',
        icons: [
          {
            src: 'icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 86400
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        picker: path.resolve(__dirname, 'picker.html'),
      },
    },
  },
  // Tauri expects a fixed dev port and must see Rust errors in the terminal.
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
