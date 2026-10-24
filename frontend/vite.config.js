import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api/* is proxied to the backend (default :4000). Override with VITE_API_TARGET.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true } } },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { antd: ['antd', '@ant-design/icons'], react: ['react', 'react-dom', 'react-router-dom'] } } },
  },
});
