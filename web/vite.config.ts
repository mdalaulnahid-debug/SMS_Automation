import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // The existing Node backend (src/server.js) already serves every
    // /api/* route this app needs — proxy instead of duplicating logic.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
