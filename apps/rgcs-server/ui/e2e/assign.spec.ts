import { expect, test, type Page } from '@playwright/test'
import { login } from './helpers'

// The flight plan screen's 割当 mode (spec 2026-10-31). Plans are saved through the API and
// deleted at the end of each test. Nothing here writes to a vehicle: 書き込む is never clicked.

const H = { 'X-Requested-With': 'rgcs' }

const item = (command: number, lat: number, lon: number) => ({ command, frame: 'rel', params: [0, 0, 0, 0], lat, lon, alt: 50, autocontinue: true })

/** A copter plan near the SITL home (Kamikochi): a takeoff and two waypoints. */
const plan = (name: string) => ({
  id: null, name, sysid: null, default_alt: 50, default_frame: 'rel', speed: 8, home: null,
  items: [item(22, 0, 0), item(16, 36.2515, 137.639), item(16, 36.2525, 137.6395)],
  fence: [], rally: [], surveys: [],
})

/** Saves two plans as the logged-in page; returns their ids and names. */
async function savePlans(page: Page): Promise<{ ids: number[]; names: string[] }> {
  const stamp = Date.now()
  const names = [`e2e 割当 A ${stamp}`, `e2e 割当 B ${stamp}`]
  const ids: number[] = []
  for (const name of names) {
    const res = await page.request.post('/api/missions', { headers: H, data: plan(name) })
    expect(res.status()).toBe(201)
    ids.push((await res.json()).data.id)
  }
  return { ids, names }
}

async function deletePlans(page: Page, ids: readonly number[]): Promise<void> {
  for (const id of ids) await page.request.delete(`/api/missions/${id}`, { headers: H })
}

async function openBoard(page: Page) {
  await page.getByRole('button', { name: 'フライトプラン' }).click()
  await expect(page.getByTestId('mission-view')).toBeVisible()
  await page.getByRole('group', { name: 'モード' }).getByRole('button', { name: '割当' }).click()
  await expect(page.getByRole('complementary', { name: 'プラン', exact: true })).toBeVisible()
}

const planCard = (page: Page, name: string) => page.getByRole('complementary', { name: 'プラン', exact: true }).getByRole('button', { name })
const vehicleList = (page: Page) => page.getByTestId('as-vehicle-list')

test('the board lists saved plans, shows no vehicles without a link and 編集 returns to the editor', async ({ page }) => {
  await login(page)
  const { ids, names } = await savePlans(page)
  try {
    await openBoard(page)
    for (const name of names) {
      await expect(planCard(page, name)).toBeVisible()
      await expect(planCard(page, name).locator('.as-ptag')).toHaveText('未割当')
    }
    // without --with-sitl the server has no link: the vehicle panel shows its empty state
    if (!process.env.RGCS_E2E_SITL) {
      await expect(vehicleList(page)).toContainText('該当する機体はありません')
      await expect(vehicleList(page).locator('.as-vcard')).toHaveCount(0)
    }
    await page.getByRole('group', { name: 'モード' }).getByRole('button', { name: '編集' }).click()
    await expect(page.getByRole('complementary', { name: 'プラン', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('プラン名')).toBeVisible()
  } finally {
    await deletePlans(page, ids)
  }
})

test('tap-assign a plan to the vehicle, it persists over a reload, × unassigns it', async ({ page }) => {
  test.skip(!process.env.RGCS_E2E_SITL, 'needs SITL')
  await login(page)
  const { ids, names } = await savePlans(page)
  try {
    await openBoard(page)
    const card = vehicleList(page).locator('.as-vcard').first()
    await expect(card).toBeVisible({ timeout: 20_000 })
    await planCard(page, names[0]!).click()
    // apart from the first tap, so it is not a double-tap
    await page.waitForTimeout(600)
    await card.click()
    await expect(card.locator('.as-sname')).toHaveText(names[0]!)
    await expect(page.getByRole('status').filter({ hasText: 'に割り当てました' })).toBeVisible()
    await expect(planCard(page, names[0]!).locator('.as-ptag')).toHaveText('1 機に割当')
    await page.reload()
    await openBoard(page)
    await expect(card.locator('.as-sname')).toHaveText(names[0]!, { timeout: 20_000 })
    await expect(card).toContainText('書込待ち')
    await card.getByRole('button', { name: /の割当を外す$/ }).click()
    await expect(card.locator('.as-sname')).toHaveCount(0)
    await expect(planCard(page, names[0]!).locator('.as-ptag')).toHaveText('未割当')
  } finally {
    await deletePlans(page, ids)
  }
})
