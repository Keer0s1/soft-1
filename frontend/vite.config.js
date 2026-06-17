import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Во время разработки фронт на :5173 проксирует /api и /files на бэкенд :8000
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/files': 'http://localhost:8000',
      '/socket.io': {
        target: 'http://localhost:8000',
        ws: true,
      },
    },
  },
});
