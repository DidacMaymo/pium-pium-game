import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// El mismo juego, pero Trystero usa el relay local (los tests no dependen de internet).
export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  resolve: { alias: { trystero: fileURLToPath(new URL('./trystero-local.js', import.meta.url)) } },
  server: { port: 5174, strictPort: true },
});
