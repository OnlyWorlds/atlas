import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** The CSP has one home, public/_headers (what Pages serves, #302); preview serves the same line so a walk runs under it. */
const CSP = readFileSync('public/_headers', 'utf8').match(/Content-Security-Policy: (.+)/)?.[1]?.trim() ?? '';

export default defineConfig({
  // Absolute: the app is served at more than the root since Sign in with
  // OnlyWorlds (`/signin/callback`, public/_redirects), and a relative './'
  // resolved its scripts under /signin/ there (the S465 gate's G1).
  base: '/',
  // Staging work points at keel directly via the localStorage
  // 'atlas_dev_api_base' override (dev-api-base.ts) — keel serves CORS since
  // 2026-07-11 (P15), so the old /keel dev proxy retired.
  server: { port: 3045 },
  preview: { headers: CSP ? { 'Content-Security-Policy': CSP } : {} },
  build: {
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      // Two HTML entries: the app (index.html) and the static public
      // changelog (changelog.html, emitted by `npm run changelog` before
      // build). The changelog carries no module scripts, so Vite just emits
      // it to dist/changelog.html.
      input: {
        main: 'index.html',
        changelog: 'changelog.html',
      },
    },
  },
  plugins: [
    VitePWA({
      // 'prompt' (S360): 'autoUpdate' reloaded the page under a returning
      // visitor the moment a new deploy's worker took over (they saw the old
      // app, then a reload mid-click). Now the new version waits and offers
      // itself (core/offline.ts); closing every Atlas tab also picks it up.
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon.png', 'owlogo.png'],
      manifest: {
        name: 'Atlas · OnlyWorlds',
        short_name: 'Atlas',
        description: 'Local-first OnlyWorlds world browser and editor.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        // Hash-routing app — start_url at the app root is correct.
        start_url: './',
        icons: [
          {
            src: 'owlogo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Precache the built assets. Material Symbols woff2 is bundled by
        // Vite into /assets and matched by this glob, so the font is offline-
        // available after first load.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // og.png is the social card: crawlers fetch it, the app never does,
        // and a visitor should not pay 100 KB of precache for an image their
        // browser will never request (S323). assets/404.html (public/) makes
        // Cloudflare Pages answer a missing /assets/* file with a 404 instead
        // of the app page, so a tab from before a deploy fails its lazy chunk
        // honestly (conv. 121, Boss's probe S366); nothing in the app loads it.
        globIgnores: ['**/og.png', 'assets/404.html'],
        // The Material Symbols outlined font is ~4 MB (covers thousands of
        // icons). Subsetting to atlas's ~40 used icons would drop it to
        // ~50 KB — deferred optimization. For now, bump the precache size
        // ceiling so the font lands in the offline cache.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // The bundled .webp images (the tour's maps, the example page's
        // Sikelia map at 1.6 MB) are NOT precached: every visitor would pay
        // ~2 MB for pictures most never open. Cache-first once fetched, so a
        // tour run online works offline afterwards (S365 lane B L3: offline,
        // the tour's maps were blank).
        runtimeCaching: [{
          urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.endsWith('.webp'),
          handler: 'CacheFirst',
          options: { cacheName: 'atlas-images', expiration: { maxEntries: 16 } },
        }],
        // Keep the SW out of the way of dev tools.
        navigateFallback: null,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
