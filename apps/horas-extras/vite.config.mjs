import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  build: {
    outDir: 'dist/client',
  },
  optimizeDeps: {
    include: ['react', 'react-dom/client'],
  },
  server: {
    host: process.env.OVERTIME_LOCAL_EMULATOR === 'true' ? '127.0.0.1' : '0.0.0.0',
    port: process.env.OVERTIME_LOCAL_EMULATOR === 'true' ? 8801 : undefined,
    strictPort: process.env.OVERTIME_LOCAL_EMULATOR === 'true',
    proxy:
      process.env.OVERTIME_LOCAL_EMULATOR === 'true'
        ? { '/api/overtime': 'http://127.0.0.1:8802' }
        : undefined,
    allowedHosts: ['terminal.local'],
    warmup: {
      clientFiles: ['./src/main.jsx'],
    },
  },
  plugins: [react()],
});
