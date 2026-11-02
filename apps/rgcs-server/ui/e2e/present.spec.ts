import { expect, test, type APIRequestContext } from '@playwright/test'
import { DEV_USER, login } from './helpers'

// Needs scripts/e2e.sh --with-video (MediaMTX + ffmpeg test pattern). Acceptance 7-1 of the
// While the operator does a full sweep, the audience video never stalls > 1 s.
test.skip(!process.env.RGCS_E2E_VIDEO, 'needs MediaMTX and ffmpeg')

async function adminToken(request: APIRequestContext): Promise<string> {
  const h = { 'X-Requested-With': 'rgcs' }
  const login = await request.post('/api/auth/login', { headers: h, data: DEV_USER })
  expect(login.ok()).toBeTruthy()
  const created = await request.post('/api/settings/presentation/tokens', { headers: h, data: { label: 'e2e' } })
  expect(created.ok()).toBeTruthy()
  return ((await created.json()) as { data: { token: string } }).data.token
}

test('the audience video keeps playing through an operator sweep', async ({ browser, request }) => {
  // A whole operator journey; over emulated LTE (accept-stack) it outlasts the 30 s default. The
  // requirement is the stall bound below, not the journey's length.
  test.setTimeout(60_000)
  const token = await adminToken(request)
  const audience = await browser.newPage()
  await audience.goto(`/present?t=${token}`)
  const video = audience.locator('video.present-video')
  await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(0.5)

  const samples: number[] = []
  const sampler = setInterval(() => {
    void video.evaluate((v: HTMLVideoElement) => v.currentTime).then((t) => samples.push(t)).catch(() => {})
  }, 200)

  const operator = await browser.newPage()
  await login(operator)
  await operator.getByRole('button', { name: DEV_USER.username }).click()
  await operator.getByRole('button', { name: '観客用画面' }).click()
  await expect(operator.getByRole('dialog')).toBeVisible()
  await operator.getByRole('dialog').getByRole('button', { name: '閉じる' }).click()
  if (process.env.RGCS_E2E_SITL && process.env.RGCS_E2E_SIM) {
    await expect(operator.locator('.rg-mk')).toHaveCount(1, { timeout: 20_000 })
    await operator.getByRole('option').first().click()
    await expect(operator.locator('.cam-strip')).toBeVisible({ timeout: 10_000 })
    await operator.getByRole('button', { name: 'IR' }).click()
    await operator.getByRole('button', { name: 'RGB' }).click()
    await operator.getByRole('button', { name: '全コマンド' }).click()
    await operator.locator('aside.sheet').getByRole('button', { name: '閉じる' }).click()
  }
  await operator.getByRole('button', { name: DEV_USER.username }).click()
  await operator.getByRole('button', { name: 'ログアウト' }).click()
  await expect(operator.getByRole('button', { name: 'ログイン' })).toBeVisible()
  await audience.waitForTimeout(2000)
  clearInterval(sampler)

  expect(samples.length).toBeGreaterThan(10)
  let maxGap = 0
  for (let i = 1; i < samples.length; i++) {
    const advanced = samples[i]! - samples[i - 1]!
    if (advanced <= 0) maxGap += 0.2
    else maxGap = 0
    expect(maxGap, `video stalled for ${maxGap.toFixed(1)} s around sample ${i}`).toBeLessThanOrEqual(1)
  }
  await expect(audience.locator('.present-badge')).toHaveCount(0)
})
