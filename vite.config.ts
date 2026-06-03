import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// `base` must match how the app is served.
// - Custom domain (my.unforced.org) or user/org page: '/'
// - GitHub Pages project site (username.github.io/my-vault-ui/): '/my-vault-ui/'
// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    react(),
    VitePWA({
      // We register + drive updates ourselves (UpdateBanner via useRegisterSW),
      // so the new service worker WAITS until the user taps "Refresh".
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'favicon-64.png', 'icon.svg'],
      manifest: {
        name: 'Vault — a quiet garden for the mind',
        short_name: 'Vault',
        description:
          'A calm, Today-first thinking surface for your Parachute Vault — capture, weave, and tend your knowledge graph.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme_color: '#c06b4a',
        background_color: '#f7f1e6',
        categories: ['productivity', 'lifestyle'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        // SPA navigations fall back to the app shell — EXCEPT vault/auth calls,
        // which must always hit the network (never the precache).
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/oauth\//, /^\/\.well-known\//],
        runtimeCaching: [
          {
            // Google Fonts CSS + files: stale-while-revalidate so the app shell
            // renders with the right typography even offline.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        // The vault API is never cached by the SW — offline writes go through our
        // own IndexedDB outbox (src/vault/sync), not Workbox.
      },
    }),
  ],
})
