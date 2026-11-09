import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import path from 'node:path';

// One Vite project: the React app (src/app) and the Hono Worker (src/worker) are built
// together; `vite dev` runs the Worker in workerd with a local D1 so /api works in dev.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ configPath: './wrangler.jsonc' })],
  resolve: {
    alias: { '@shared': path.resolve(import.meta.dirname, 'src/shared'), '@app': path.resolve(import.meta.dirname, 'src/app') },
  },
  // The Cloudflare plugin writes the client to dist/client and the Worker to dist/<worker name>.
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
});
