import { expect, test } from '@playwright/test'
import { countLogRows, holdToRun, login, waitForLogRow } from './helpers'

// Needs scripts/e2e.sh --with-sitl (ArduCopter SITL on tcp:5760).
test.skip(!process.env.RGCS_E2E_SITL, 'needs SITL')

const ARM = /^アーム (成功|失敗)/
const DISARM = /^ディスアーム/

test('vehicle marker, detail panel and a confirmed ARM / DISARM', async ({ page }) => {
  await login(page)
  await expect(page.locator('.rg-mk')).toHaveCount(1, { timeout: 20_000 })
  await page.getByRole('option').first().click()
  await expect(page.locator('.detail')).toBeVisible()
  const arms = await countLogRows(page, ARM)
  await page.getByRole('button', { name: '全コマンド' }).click()
  await page.getByRole('button', { name: 'アーム', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('アーム')
  await page.getByRole('button', { name: '実行' }).click()
  const outcome = await waitForLogRow(page, ARM, arms)
  const armed = outcome.includes('成功')
  if (armed) {
    await expect(page.locator('.detail .msg .ttl').first()).toBeVisible()
    const disarms = await countLogRows(page, DISARM)
    // the command panel stays open across commands (2026-10-19)
    await expect(page.getByRole('complementary', { name: '全コマンド' })).toBeVisible()
    await page.getByRole('button', { name: 'ディスアーム', exact: true }).click()
    await holdToRun(page)
    await waitForLogRow(page, DISARM, disarms)
  } else {
    // PreArm failures arrive as STATUSTEXT and must show in the panel.
    await expect(page.locator('.detail .msg .ttl').first()).toContainText(/PreArm|Arm/i)
  }
})
