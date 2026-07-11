import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  // Staging work points at keel directly via the localStorage
  // 'atlas_dev_api_base' override (dev-api-base.ts) — keel serves CORS since
  // 2026-07-11 (P15), so the old /keel dev proxy retired.
  server: { port: 3045 },
  build: {
    target: 'es2020',
    outDir: 'dist'
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.png', 'owlogo.png'],
      manifest: {
        name: 'Atlas — OnlyWorlds',
        short_name: 'Atlas',
        description: 'Folder-first OnlyWorlds world browser and editor.',
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
        // The Material Symbols outlined font is ~4 MB (covers thousands of
        // icons). Subsetting to atlas's ~40 used icons would drop it to
        // ~50 KB — deferred optimization. For now, bump the precache size
        // ceiling so the font lands in the offline cache.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Keep the SW out of the way of dev tools.
        navigateFallback: null,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
