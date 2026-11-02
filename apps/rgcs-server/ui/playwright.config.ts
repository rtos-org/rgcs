import { defineConfig, devices } from '@playwright/test'

// The server under test is started by scripts/e2e.sh (built UI served by rgcs-server).
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8010'

// The 3D map needs a GPU: headless Chromium draws the terrain in software (SwiftShader), slow
// enough to time clicks out. On macOS use the installed Chrome with Metal (E2E_GPU=0 opts out);
// CI / Linux keeps the bundled headless Chromium.
const gpu = process.platform === 'darwin' && process.env.E2E_GPU !== '0'
const gpuLaunch = gpu ? { channel: 'chrome', launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } } : {}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...gpuLaunch } }],
})
