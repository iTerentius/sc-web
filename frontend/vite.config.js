import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // Dev-only proxy so `npm run dev` works without the full docker stack
  server: {
    proxy: {
      '/ws':     { target: 'ws://localhost:4000', ws: true, changeOrigin: true },
      '/stream': { target: 'http://localhost:8000', changeOrigin: true,
                   rewrite: (path) => '/stream.mp3' },
    },
  },
});
