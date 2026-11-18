import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api/* is proxied to the backend (default :4000). Override with VITE_API_TARGET.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true } } },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    // A function (not a list of package names) keeps tree-shaking: only the antd components and icons that are really used end up in the vendor chunks.
    rollupOptions: { output: { manualChunks(id) {
      if (!id.includes('node_modules')) return undefined;
      if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|@remix-run)\//.test(id)) return 'react';
      return undefined;
    } } },
  },
});
