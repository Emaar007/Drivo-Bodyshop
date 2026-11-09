import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Tests run in plain Node against the pure modules; the Cloudflare plugin is not loaded here.
export default defineConfig({
  resolve: {
    alias: { '@shared': path.resolve(import.meta.dirname, 'src/shared') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
