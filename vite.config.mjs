import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The new React app lives in `src/` and builds to `dist/`. The legacy vanilla
// app in `public/` is left intact during the migration, so Vite's automatic
// publicDir copy is disabled to avoid pulling the old app into the build.
// Genuine static PWA assets (manifest, icons, service worker) live in `static/`.
export default defineConfig({
  plugins: [react()],
  publicDir: 'static',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
  },
});
