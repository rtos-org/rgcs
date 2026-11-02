/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { woff2Only } from './src/build/woff2Only.js'

// Dev: the UI runs on :5173 and talks to a local rgcs-server on :8000.
const SERVER = process.env.RGCS_SERVER ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), woff2Only()],
  server: {
    // Tailscale MagicDNS names (`tailscale serve` forwards the tailnet's :5173 to this server).
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
      // Audience endpoints (the /present page itself stays with Vite's SPA fallback).
      '/present/config': SERVER,
      '/present/vehicle': SERVER,
      '/present/logo': SERVER,
      '/present/whep': SERVER,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**'], exclude: ['src/shared/api/generated/**', 'src/test/**', 'src/main.tsx'] },
  },
})
