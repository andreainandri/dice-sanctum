import { defineConfig } from 'vite';

// La pagina sta in src/client; il ponte serve dist/client.
export default defineConfig({
  root: 'src/client',
  base: './',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    target: 'es2023',
    // Rapier porta il suo WASM dentro il modulo: il pezzo è grande per forza.
    chunkSizeWarningLimit: 6000,
  },
  server: { host: '127.0.0.1', port: 4778, strictPort: true },
  preview: { host: '127.0.0.1', port: 4778, strictPort: true },
});
