import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 3045 },
  build: {
    target: 'es2020',
    outDir: 'dist'
  }
});
