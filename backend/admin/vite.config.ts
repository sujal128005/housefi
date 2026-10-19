import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The portal is a static site served by its own nginx (deploy/admin.nginx.conf), which passes /v1/admin/ to the API.
// For local work, `npm run dev` passes /v1 to a local API with the portal's host name.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, assetsInlineLimit: 0 },
  server: {
    proxy: { '/v1': { target: 'http://localhost:4000', changeOrigin: false, headers: { host: process.env.ADMIN_HOST ?? 'localhost' } } },
  },
});
