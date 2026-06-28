import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import process from 'node:process';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    (process.env.ANALYZE === 'true' || mode === 'analyze')
      ? visualizer({
        filename: 'reports/bundle-stats.html',
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      })
      : null,
  ].filter(Boolean),
  esbuild: {
    drop: ['debugger'],
    pure: ['console.log', 'console.debug', 'console.info'],
  },
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: process.env.BUILD_SOURCEMAP === 'true',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (!normalized.includes('/node_modules/')) return undefined;
          if (/\/node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(normalized)) return 'vendor-react';
          if (/\/node_modules\/(?:firebase\/(?:app|auth|database)|@firebase\/(?:app|auth|database|component|logger|util|webchannel-wrapper))\//.test(normalized)) {
            return 'vendor-firebase-startup';
          }
          if (/\/node_modules\/(?:firebase\/storage|@firebase\/storage)\//.test(normalized)) return 'vendor-firebase-storage';
          if (/\/node_modules\/(?:firebase\/messaging|@firebase\/messaging)\//.test(normalized)) return 'vendor-firebase-messaging';
          if (normalized.includes('/node_modules/firebase/') || normalized.includes('/node_modules/@firebase/')) return 'vendor-firebase-functions-other';
          if (normalized.includes('/node_modules/@phosphor-icons/')) return 'vendor-icons';
          return undefined;
        },
      },
    },
  },
}));
