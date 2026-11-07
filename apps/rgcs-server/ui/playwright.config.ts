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
  // The suite drives the Japanese UI (helpers fill ユーザー名 / パスワード) and the
  // app picks its language from navigator.languages, so pin the browser to a
  // Japanese environment: on an en-US machine (e.g. a stock CI runner) the app
  // would render in English and every login would time out. The zone is pinned
  // for the same reason — the UI formats times in the local zone.
  use: { baseURL, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...gpuLaunch } }],
})
