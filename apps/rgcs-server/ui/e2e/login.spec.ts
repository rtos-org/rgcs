import { expect, test } from '@playwright/test'
import { DEV_USER, login } from './helpers'

test('wrong password shows the error line', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('ユーザー名').fill(DEV_USER.username)
  await page.getByLabel('パスワード').fill('wrong')
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.getByRole('alert')).toHaveText('ユーザー名またはパスワードが違います')
})

test('admin/admin signs in, the session survives a reload, logout returns to login', async ({ page, request }) => {
  await login(page)
  await page.reload()
  await expect(page.locator('header .brand')).toHaveText('RGCS')
  // A stored session opens the app directly: no sign-in scene on reload.
  await expect(page.locator('.ls-overlay, .ls-backdrop')).toHaveCount(0)
  await page.getByRole('button', { name: DEV_USER.username }).click()
  await page.getByRole('button', { name: 'ログアウト' }).click()
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible()
  const me = await request.get('/api/auth/me', { headers: { 'X-Requested-With': 'rgcs' } })
  expect(me.status()).toBe(401)
})

test('sign-in gathers the clouds, mounts the app under them and clears into it', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('ユーザー名').fill(DEV_USER.username)
  await page.getByLabel('パスワード').fill(DEV_USER.password)
  await page.getByLabel('パスワード').press('Enter')
  const clouds = page.locator('.ls-clouds')
  await expect(clouds).toHaveAttribute('data-phase', 'gather')
  await expect(page.getByRole('button', { name: 'サインイン中…' })).toBeDisabled()
  await expect(page.locator('.shell')).toHaveCount(0)
  await expect(clouds).toHaveAttribute('data-phase', 'done', { timeout: 5_000 })
  await expect(page.locator('.shell')).toHaveCount(1)
  await expect(clouds).toHaveAttribute('data-phase', 'clear', { timeout: 5_000 })
  await expect(page.locator('.ls-overlay')).toHaveCount(0, { timeout: 8_000 })
  await expect(page.locator('header .brand')).toBeVisible()
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  test('signs in with a short crossfade and no clouds', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('ユーザー名').fill(DEV_USER.username)
    await page.getByLabel('パスワード').fill(DEV_USER.password)
    await page.getByLabel('パスワード').press('Enter')
    await expect(page.locator('header .brand')).toBeVisible()
    await expect(page.locator('.ls-overlay')).toHaveCount(0, { timeout: 2_000 })
    await expect(page.locator('.ls-clouds')).toHaveCount(0)
  })
})
