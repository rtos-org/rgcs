import { expect, test } from '@playwright/test'
import { login } from './helpers'

// The 2D / 3D switch works without a vehicle and without DEM tiles: the badges carry the
// altitude chip as soon as 3D is on, and the pick survives a reload (per browser).
test('mission map switches to 3D, shows altitude chips and remembers the mode', async ({ page }) => {
  // headless Chromium renders the 3D terrain in software (SwiftShader): the first frames are slow
  test.setTimeout(90_000)
  await login(page)
  await page.getByRole('button', { name: 'フライトプラン', exact: true }).first().click()
  const map = page.getByTestId('mission-map')
  await expect(map).toBeVisible()
  await page.getByRole('button', { name: '追加', exact: true }).click()
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.click(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40)
  // 2 items without a vehicle, 3 with one (the first click also puts the TAKEOFF at the vehicle)
  await expect(page.locator('.wrow')).not.toHaveCount(0)
  const rows = await page.locator('.wrow').count()
  expect(rows).toBeGreaterThanOrEqual(2)
  // without a vehicle the TAKEOFF has no anchor (no home) and draws no badge
  await expect(page.locator('.rg-wp')).toHaveCount(rows - 1)
  await expect(page.locator('.rg-wp .chip.altc')).toHaveCount(0)
  await page.getByRole('button', { name: '3D' }).click()
  await expect(page.locator('.rg-wp .chip.altc').first()).toContainText(/^\d+ m (REL|ABS|TER)$/, { timeout: 20_000 })
  await page.reload()
  await page.getByRole('button', { name: 'フライトプラン', exact: true }).first().click()
  await expect(page.getByRole('button', { name: '3D' })).toHaveClass('on', { timeout: 20_000 })
  await page.getByRole('button', { name: '2D' }).click()
  await expect(page.getByRole('button', { name: '2D' })).toHaveClass('on')
})
