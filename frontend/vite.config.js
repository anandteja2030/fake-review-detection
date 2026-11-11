import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Bind 0.0.0.0 for cloud preview; allow the sandbox preview hostname via env.
const additionalHosts = process.env.VITE_ADDITIONAL_ALLOWED_HOSTS || '';

export default defineConfig({
  root: './',
  // GitHub project site: https://anandteja2030.github.io/fake-review-detection/
  base: '/fake-review-detection/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    allowedHosts: additionalHosts ? additionalHosts.split(',').filter(Boolean) : [],
    proxy: { '/api': 'http://127.0.0.1:4000' }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          three: ['three', '@react-three/fiber']
        }
      }
    }
  }
});
