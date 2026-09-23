import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Single-origin in production: the FastAPI backend serves dist/ and the API
// from the same host, so no base path or CORS juggling is needed. The dev
// proxy below lets `npm run dev` talk to a locally running backend.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
