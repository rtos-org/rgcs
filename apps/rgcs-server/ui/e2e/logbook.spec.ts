import { expect, test, type Page } from '@playwright/test'
import { countLogRows, holdToRun, login, waitForLogRow } from './helpers'

async function openMaint(page: Page) {
  await login(page)
  await page.getByRole('button', { name: 'メンテナンス・設定' }).click()
  await expect(page.getByTestId('maint-view')).toBeVisible()
}

const ARM = /^アーム (成功|失敗)/
const DISARM = /^ディスアーム/

test('the daily inspection, logbook, checks & calibration and app settings tabs are enabled', async ({ page }) => {
  await openMaint(page)
  for (const name of ['日常点検', '飛行日誌', '点検・校正', 'アプリ設定']) await expect(page.getByRole('button', { name })).not.toHaveAttribute('aria-disabled')
})

test('inspection run saves and appears in the list', async ({ page }) => {
  test.skip(!process.env.RGCS_E2E_SITL, 'needs a connected vehicle')
  await openMaint(page)
  await page.getByRole('button', { name: '日常点検' }).click()
  const items = page.getByTestId('inspection-item')
  await expect(items).toHaveCount(9)
  for (const i of [0, 1, 2]) await items.nth(i).getByRole('button', { name: '正常' }).click()
  await page.getByLabel('実施場所').fill('テスト場')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByTestId('inspection-saved')).toContainText('保存しました')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
  await expect(page.getByTestId('inspection-run').first()).toContainText(today)
})

test('app settings saves the registry and it persists', async ({ page }) => {
  test.skip(!process.env.RGCS_E2E_SITL, 'needs a connected vehicle')
  await openMaint(page)
  await page.getByRole('button', { name: 'アプリ設定' }).click()
  const reg = page.getByLabel('登録記号(届出番号)')
  await reg.fill('JU-E2E')
  await page.getByTestId('registry-card').getByRole('button', { name: '保存' }).click()
  await expect(page.getByTestId('registry-card')).toContainText('保存しました')
  await page.reload()
  await page.getByRole('button', { name: 'メンテナンス・設定' }).click()
  await page.getByRole('button', { name: 'アプリ設定' }).click()
  await expect(page.getByLabel('登録記号(届出番号)')).toHaveValue('JU-E2E')
})

test('arm, hover, disarm → a flight draft appears; edit and confirm it; export links respond', async ({ page }) => {
  test.skip(!process.env.RGCS_E2E_SITL, 'needs SITL')
  test.setTimeout(180_000)
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
  test.skip(!armed, 'SITL refused to arm (PreArm)')
  await page.waitForTimeout(5_000)
  const disarms = await countLogRows(page, DISARM)
  // the command panel stays open across commands (2026-10-19)
  await expect(page.getByRole('complementary', { name: '全コマンド' })).toBeVisible()
  await page.getByRole('button', { name: 'ディスアーム', exact: true }).click()
  await holdToRun(page)
  await waitForLogRow(page, DISARM, disarms)

  await page.getByRole('button', { name: 'メンテナンス・設定' }).click()
  await page.getByRole('button', { name: '飛行日誌' }).click()
  const row = page.getByTestId('flight-row').last()
  await expect(row).toContainText('下書き', { timeout: 15_000 })
  await expect(row).toContainText('1 分')
  await row.getByRole('button', { name: '編集' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('離陸場所').fill('SITL')
  await sheet.getByRole('button', { name: '確定する' }).click()
  await expect(row).toContainText('確定', { timeout: 10_000 })

  const href = await page.getByRole('link', { name: 'PDF 出力' }).getAttribute('href')
  const res = await page.request.get(href ?? '')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('application/pdf')
})
