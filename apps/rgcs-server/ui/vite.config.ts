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
    // Several component tests render large trees in jsdom and legitimately take
    // well over vitest's 5 s default on shared CI runners (they are slow, not
    // hung: the same tests pass unchanged with a larger budget). Keep the limit
    // finite so a real hang still fails.
    testTimeout: 30_000,
    // Fixtures carry JST wall-clock expectations (e.g. epoch 1761400000000 is
    // "22:46:40 JST") and the components format times in the local zone. Pin
    // the zone so the suite is deterministic on UTC machines and CI runners.
    env: { TZ: 'Asia/Tokyo' },
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**'], exclude: ['src/shared/api/generated/**', 'src/test/**', 'src/main.tsx'] },
  },
})
