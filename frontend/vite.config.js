import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Radiology image viewer (components/radiology): @cornerstonejs/dicom-image-loader starts its
  // decode workers and finds its WebAssembly codecs with new URL('…', import.meta.url), which
  // Vite rewrites and emits (the .wasm files are fetched only when a study needs that codec).
  // Pre-bundling would break those paths in dev, so the loader is left as is; its CommonJS
  // codecs and dicom-parser are pre-bundled instead.
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: [
      'dicom-parser',
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-libjxl/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
    ],
  },
  // the decode worker imports its codecs lazily (code-split), which needs ES-module workers
  worker: { format: 'es' },
  server: {
    port: 5180,
    strictPort: true, // 5173 is kept free for other projects
    proxy: {
      '/api': {
        // Point at another API with API_TARGET=http://localhost:4100
        target: process.env.API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
      // live updates (context/RealtimeContext.jsx): socket.io long-polling + WebSocket upgrade
      '/socket.io': {
        target: process.env.API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    // built files go under /static/ so they can't collide with app routes such as /assets/* (Biomedical assets)
    assetsDir: 'static',
  },
})
