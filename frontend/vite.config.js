import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    strictPort: true, // 5180 / 4000 belong to Hospital Samadhan, so both projects can run side by side
    proxy: {
      '/api': {
        // Point at another API with API_TARGET=http://localhost:4200
        target: process.env.API_TARGET || 'http://localhost:4100',
        changeOrigin: true,
      },
      // live updates (context/RealtimeContext.jsx): socket.io long-polling + WebSocket upgrade
      '/socket.io': {
        target: process.env.API_TARGET || 'http://localhost:4100',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    // built files go under /static/ so they can't collide with app routes such as /inventory/assets
    assetsDir: 'static',
  },
})
