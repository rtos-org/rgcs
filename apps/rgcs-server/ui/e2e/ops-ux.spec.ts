import { expect, test } from '@playwright/test'
import { countLogRows, login, waitForLogRow } from './helpers'

// Needs scripts/e2e.sh --with-sitl. Operator improvements of 2026-10-19.
test.skip(!process.env.RGCS_E2E_SITL, 'needs SITL')

const PAUSE = /^一時停止 (成功|失敗)/

test('emergency pause from the detail panel, Esc closes a confirm, right-click opens Guided', async ({ page }) => {
  await login(page)
  await expect(page.locator('.rg-mk')).toHaveCount(1, { timeout: 20_000 })
  await page.getByRole('option').first().click()
  const detail = page.locator('.detail')
  const emergency = detail.getByRole('group', { name: '緊急操作' })
  await expect(emergency).toBeVisible()

  const before = await countLogRows(page, PAUSE)
  await emergency.getByRole('button', { name: '一時停止' }).click()
  await waitForLogRow(page, PAUSE, before)

  await emergency.getByRole('button', { name: '帰還' }).click()
  await expect(page.getByRole('dialog', { name: '確認' })).toContainText('ホームから')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '確認' })).toHaveCount(0)

  const map = (await page.getByTestId('map').boundingBox())!
  await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2, { button: 'right' })
  await page.getByRole('menuitem', { name: 'ここへ Guided 移動' }).click()
  await expect(page.getByRole('dialog', { name: 'Guided 移動' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Guided 移動' }).getByRole('button', { name: '閉じる' }).click()

  // Pause leaves a vehicle on the ground in BRAKE, which ArduCopter refuses to arm in: put it
  // back in STABILIZE so the other journeys (and the next run) can arm.
  await detail.getByRole('button', { name: '全コマンド' }).click()
  const panel = page.getByRole('complementary', { name: '全コマンド' })
  await panel.getByRole('button', { name: 'モード変更' }).click()
  await panel.getByLabel('モード変更').selectOption('STABILIZE')
  await panel.getByRole('button', { name: '実行' }).click()
  await page.getByRole('dialog', { name: '確認' }).getByRole('button', { name: '実行' }).click()
  await expect.poll(() => page.locator('.vrow .badge').first().textContent(), { timeout: 10_000 }).toBe('STABILIZE')
})
