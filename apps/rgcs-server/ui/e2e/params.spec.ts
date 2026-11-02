import { expect, test, type Page } from '@playwright/test'
import { login } from './helpers'

async function openMaint(page: Page) {
  await login(page)
  await page.getByRole('button', { name: 'メンテナンス・設定' }).click()
  await expect(page.getByTestId('maint-view')).toBeVisible()
}

test('the maintenance view opens on the parameters tab', async ({ page }) => {
  await openMaint(page)
  await expect(page.getByRole('button', { name: 'パラメータ' })).toHaveClass(/on/)
  await expect(page.getByRole('button', { name: 'アプリ設定' })).not.toHaveAttribute('aria-disabled')
  await page.getByRole('button', { name: '変更履歴' }).click()
  await expect(page.getByRole('button', { name: '変更履歴' })).toHaveClass(/on/)
})

test('download all parameters, search, write FENCE_ALT_MAX with confirmation, see it verified and in the history', async ({ page }) => {
  test.skip(!process.env.RGCS_E2E_SITL, 'needs SITL')
  test.setTimeout(180_000)
  await openMaint(page)
  await expect(page.getByTestId('maint-head')).toContainText('対象機体')
  const refresh = page.getByRole('button', { name: '更新' })
  await expect(refresh).toBeEnabled({ timeout: 20_000 })
  await refresh.click()
  // 1,000+ parameters arrive; the bar reaches 100 % and the counter shows n / n
  await expect(page.locator('.params-progress')).toHaveText(/^(\d+) \/ \1$/, { timeout: 90_000 })
  const total = Number((await page.locator('.params-progress').innerText()).split('/')[0])
  expect(total).toBeGreaterThan(1000)
  await page.getByRole('searchbox').fill('FENCE_ALT_MAX')
  const row = page.locator('.params-table tbody tr').filter({ hasText: 'FENCE_ALT_MAX' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Fence Maximum Altitude')
  const input = row.getByRole('spinbutton')
  const before = Number(await input.inputValue())
  const target = before === 150 ? 120 : 150

  const write = async (value: number) => {
    await input.fill(String(value))
    await input.blur()
    const changes = page.getByTestId('param-changes')
    await expect(changes).toContainText('FENCE_ALT_MAX')
    await changes.getByRole('button', { name: '書き込む' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('1 件のパラメータ')
    await dialog.getByRole('button', { name: '実行' }).click()
    const results = page.getByTestId('param-results')
    await expect(results).toBeVisible({ timeout: 15_000 })
    await expect(results.locator('li').filter({ hasText: 'FENCE_ALT_MAX' }).getByLabel('検証済み')).toBeVisible()
    await expect(input).toHaveValue(String(value))
  }
  await write(target)
  await page.getByRole('button', { name: '変更履歴' }).click()
  const hist = page.locator('.params-history tbody tr').first()
  await expect(hist).toContainText(`FENCE_ALT_MAX: ${before} → ${target}`)
  await expect(hist).toContainText('admin')
  // restore
  await page.getByRole('button', { name: 'パラメータ' }).click()
  await write(before)
})
