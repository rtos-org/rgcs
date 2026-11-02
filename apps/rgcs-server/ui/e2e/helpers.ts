import { expect, type Page } from '@playwright/test'

export const DEV_USER = { username: 'admin', password: 'admin' }

export async function login(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('ユーザー名').fill(DEV_USER.username)
  await page.getByLabel('パスワード').fill(DEV_USER.password)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.locator('header .brand')).toHaveText('RGCS')
  // The sign-in clouds take ~7 s to gather and clear; the app is interactive once they are gone.
  await expect(page.locator('.ls-overlay')).toHaveCount(0, { timeout: 20_000 })
}

const sheet = (page: Page) => page.locator('.logsheet')
const rows = (page: Page, text: RegExp) => sheet(page).locator('.logrow').filter({ has: page.locator('.txt', { hasText: text }) })

async function setLogOpen(page: Page, open: boolean): Promise<void> {
  if ((await sheet(page).isVisible()) !== open) await page.locator('button.logpill').click()
  await expect(sheet(page)).toBeVisible({ visible: open })
}

/** How many rows of メッセージ履歴 have a text matching `text` (the log persists across runs). */
export async function countLogRows(page: Page, text: RegExp): Promise<number> {
  await setLogOpen(page, true)
  const n = await rows(page, text).count()
  await setLogOpen(page, false)
  return n
}

/** Waits for a new matching row (more than `before`) and returns the newest one's text. */
export async function waitForLogRow(page: Page, text: RegExp, before: number, timeout = 10_000): Promise<string> {
  await setLogOpen(page, true)
  await expect.poll(() => rows(page, text).count(), { timeout }).toBeGreaterThan(before)
  const newest = (await rows(page, text).first().locator('.txt').textContent()) ?? ''
  await setLogOpen(page, false)
  return newest
}

/** Disarming an armed vehicle needs a 1.5 s press on the confirm's execute button (P9). */
export async function holdToRun(page: Page): Promise<void> {
  const button = page.getByRole('dialog', { name: '確認' }).getByRole('button', { name: /長押しで実行/ })
  const box = (await button.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(1_700)
  await page.mouse.up()
  await expect(page.getByRole('dialog', { name: '確認' })).toHaveCount(0)
}
