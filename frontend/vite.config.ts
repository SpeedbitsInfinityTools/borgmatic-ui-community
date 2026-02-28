import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Get backend port from environment or default to 8000
const BACKEND_PORT = process.env.BACKEND_PORT || process.env.PORT || '8000'
// Get frontend port from environment or default to 5173
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '5173', 10)
// Director mode uses HTTPS by default, client/standalone uses HTTP
// Check if backend is HTTPS (Director mode typically uses SSL)
const BACKEND_PROTOCOL = process.env.BACKEND_HTTPS === 'true' ? 'https' : 'http'
const BACKEND_URL = `${BACKEND_PROTOCOL}://localhost:${BACKEND_PORT}`

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: FRONTEND_PORT,
    host: true, // Bind to all interfaces (needed for Docker/WSL access)
    proxy: {
      '/api/events/stream': {
        target: BACKEND_URL,
        changeOrigin: true,
        ws: true,
        secure: false, // Allow self-signed certificates
        timeout: 0, // No timeout for SSE
        proxyTimeout: 0,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, _req, _res) => {
            // Don't timeout SSE connections
            proxyReq.setTimeout(0);
          });
        },
      },
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        ws: true,
        secure: false, // Allow self-signed certificates
      },
    },
  },
  build: {
    outDir: 'build',
    sourcemap: false,  // No sourcemaps in production (smaller bundle, no code exposure)
  },
}) 