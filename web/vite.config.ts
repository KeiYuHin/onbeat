import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from phones on the LAN
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
