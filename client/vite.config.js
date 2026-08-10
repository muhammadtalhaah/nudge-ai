import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const SERVER_ORIGIN = 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Contracts live at the repo root and are shared with the server. They are plain
      // ES modules, so there is no build step between the two packages.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    // Required so the dev server may serve files from ../shared (outside the client root).
    fs: { allow: ['..'] },
    // Same-origin in dev, which is what lets the httpOnly refresh cookie work without
    // SameSite=None. Production serves the built bundle from the API itself.
    proxy: {
      '/api': { target: SERVER_ORIGIN, changeOrigin: true },
      '/socket.io': { target: SERVER_ORIGIN, ws: true },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
});
