import { expect, test } from '@playwright/test'
import { countLogRows, login, waitForLogRow } from './helpers'

// Needs scripts/e2e.sh --with-sitl --with-sim (the detail panel needs a vehicle; the camera is the simulator).
test.skip(!process.env.RGCS_E2E_SITL || !process.env.RGCS_E2E_SIM, 'needs SITL and the MT11 simulator')

const SAVED = /^カメラ設定 成功/

test('camera strip appears, zoom changes, record toggles, settings save', async ({ page }) => {
  await login(page)
  await expect(page.locator('.rg-mk')).toHaveCount(1, { timeout: 20_000 })
  await page.getByRole('option').first().click()
  await expect(page.locator('.detail')).toBeVisible()
  await expect(page.locator('.cam-strip')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-testid=cam-status]')).toContainText('Follow')
  await expect(page.locator('.zstep .big')).toHaveText('1.0×')
  await page.getByRole('button', { name: 'ズームイン' }).click()
  await expect(page.locator('.zstep .big')).toHaveText('2.0×', { timeout: 5_000 })
  const rec = page.getByRole('button', { name: '録画' })
  await rec.click()
  await expect(rec).toHaveClass(/on/, { timeout: 5_000 })
  await expect(page.locator('.detail-rec')).toContainText('REC')
  await rec.click()
  await expect(rec).not.toHaveClass(/on/, { timeout: 5_000 })
  await page.getByRole('button', { name: 'IR' }).click()
  await expect(page.getByRole('button', { name: 'IR' })).toHaveClass(/on/, { timeout: 5_000 })
  await page.getByRole('button', { name: 'カメラ設定' }).click()
  await expect(page.locator('.sheet.settings')).toBeVisible()
  await page.getByRole('button', { name: '操作' }).click()
  await page.getByLabel('最大パン速度').fill('40')
  const saves = await countLogRows(page, SAVED)
  await page.getByRole('button', { name: '保存' }).click()
  await waitForLogRow(page, SAVED, saves, 5_000)

  // A runtime kind change must reach the strip without a reload: none → MT11.
  await page.getByRole('button', { name: 'カメラ設定' }).click()
  await page.getByRole('button', { name: '接続' }).click()
  await page.getByLabel('カメラ種別').selectOption('none')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.cam-strip')).toHaveCount(0, { timeout: 5_000 })
  await expect(page.locator('[data-testid=cam-status]')).toContainText('カメラ未設定')
  // No strip now, so the sheet opens from the status row's setup button.
  await page.locator('[data-testid=cam-status]').getByRole('button').click()
  await page.getByRole('button', { name: '接続' }).click()
  await page.getByLabel('カメラ種別').selectOption('siyi_mt11')
  await page.getByLabel('IP').fill('127.0.0.1')
  await page.getByLabel('制御ポート').fill(process.env.RGCS_E2E_SIM_PORT ?? '37261')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.cam-strip')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-testid=cam-status]')).toContainText('Follow', { timeout: 10_000 })
})

test('strip_stays_one_row_at_max_zoom', async ({ page }) => {
  await login(page)
  await expect(page.locator('.rg-mk')).toHaveCount(1, { timeout: 20_000 })
  await page.getByRole('option').first().click()
  await expect(page.locator('.cam-strip')).toBeVisible({ timeout: 10_000 })
  const res = await page.request.post('/api/vehicles/1/camera/command', { data: { cmd: 'zoom_absolute', args: { zoom: 165 } }, headers: { 'X-Requested-With': 'rgcs' } })
  expect(res.ok()).toBe(true)
  await expect(page.locator('.zstep .big')).toHaveText('165.0×', { timeout: 5_000 })
  const boxes = await page.locator('.cam-strip > *').evaluateAll((els) =>
    els.filter((e) => !e.classList.contains('grow')).map((e) => {
      const r = e.getBoundingClientRect()
      return { top: Math.round(r.top + r.height / 2), left: r.left, right: r.right }
    }),
  )
  expect(new Set(boxes.map((b) => b.top)).size).toBe(1)
  boxes.slice(1).forEach((b, i) => expect(b.left).toBeGreaterThanOrEqual(boxes[i]!.right - 0.5))
  await page.request.post('/api/vehicles/1/camera/command', { data: { cmd: 'zoom_absolute', args: { zoom: 1 } }, headers: { 'X-Requested-With': 'rgcs' } })
})
