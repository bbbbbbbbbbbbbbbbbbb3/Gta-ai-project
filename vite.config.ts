import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps the build deployable as a static page from any sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  test: { environment: 'node' },
} as any);
