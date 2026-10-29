import { defineConfig } from 'vite';

const hosts = (process.env.VITE_ADDITIONAL_ALLOWED_HOSTS || '')
  .split(',').filter(Boolean);

export default defineConfig({
  root: '.',
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    allowedHosts: hosts.length > 0 ? hosts : undefined,
    proxy: { '/api': 'http://127.0.0.1:4000' }
  }
});
