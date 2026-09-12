import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // When VITE_API_MODE=live and VITE_API_BASE_URL is left as "/api", requests go
    // through this proxy to the Next.js backend running on :3000. That keeps the
    // browser origin single and avoids CORS config on the API routes.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
