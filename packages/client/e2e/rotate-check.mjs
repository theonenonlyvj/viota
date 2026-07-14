// rotate-check.mjs — visual check for the board-rotate fix (cards stay upright + centered).
//
// Boots a headless Chromium against a RUNNING dev server, starts a local vs-AI game,
// places one card so a numbered tile is on the board, then screenshots the board at
// 0/90/180/270 so a human can confirm cards render upright and the board stays centered.
//
// Usage:
//   1) start the client dev server:  pnpm --filter @viota/client exec vite --port 5199 --strictPort
//   2) node packages/client/e2e/rotate-check.mjs   (or VIOTA_URL=http://localhost:5173 node ...)
// Screenshots land in packages/client/e2e/screenshots/ (gitignored).
//
// Uses the raw `playwright` library (not @playwright/test) on purpose — this is a quick
// visual harness, not an e2e suite. Graduate to @playwright/test if a real suite is wanted.

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const URL = process.env.VIOTA_URL || 'http://localhost:5199'
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

const log = (...a) => console.log('[rotate-check]', ...a)

async function tryPlaceOneCard(page) {
  // Best-effort: select a hand card, click a valid placement cell, confirm.
  // No test-ids exist, so this is heuristic; if anything is off we still screenshot
  // whatever board state exists (the wild starter is enough to see centering).
  try {
    // The hand is the row of clickable card tiles at the bottom. Click the first one.
    const handCards = page.locator('[data-hand-card], .hand [role="button"], .hand > *')
    // Fallback: any clickable 56x56 white tile in the lower third — too fragile; instead
    // click the first few candidate tiles and see if valid cells light up.
    const candidates = page.locator('div').filter({ hasText: '' })
    // Simplest reliable path: click each of the human hand tiles by trying the known layout.
    // We click the first hand card element we can find, then a valid cell.
    const firstCard = handCards.first()
    if (await firstCard.count()) {
      await firstCard.click({ timeout: 2000 }).catch(() => {})
    }
    await page.waitForTimeout(300)
    // Valid cells become clickable after a card is selected. Click one near center.
    const validCell = page.locator('[data-valid-cell], .cell-valid').first()
    if (await validCell.count()) {
      await validCell.click({ timeout: 2000 }).catch(() => {})
      const confirm = page.getByRole('button', { name: /confirm play/i })
      if (await confirm.isEnabled().catch(() => false)) await confirm.click().catch(() => {})
    }
  } catch (e) {
    log('placement best-effort failed (continuing with starter board):', e.message)
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2 })
  page.on('console', (m) => { if (m.type() === 'error') log('page console error:', m.text()) })
  page.on('pageerror', (e) => log('page error:', e.message))

  log('goto', URL)
  await page.goto(URL, { waitUntil: 'networkidle' })

  log('start a local vs-AI game')
  await page.getByRole('button', { name: 'Play vs AI' }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await page.waitForURL('**/game/local', { timeout: 10000 })
  await page.waitForTimeout(800) // let the board render + autofit

  await page.screenshot({ path: path.join(OUT, '00-start.png') })
  log('screenshot 00-start.png')

  await tryPlaceOneCard(page)
  await page.waitForTimeout(500)

  const rotateCW = page.getByRole('button', { name: /rotate clockwise/i })
  for (const deg of [0, 90, 180, 270]) {
    if (deg > 0) { await rotateCW.click(); await page.waitForTimeout(400) }
    await page.screenshot({ path: path.join(OUT, `rot-${String(deg).padStart(3, '0')}.png`) })
    log(`screenshot rot-${deg}.png`)
  }

  // Also exercise persistence: trigger auto-fit and confirm rotation survives.
  const autofit = page.getByRole('button', { name: /auto.?fit|fit|recenter/i })
  if (await autofit.count()) {
    await autofit.first().click().catch(() => {})
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT, 'rot-270-after-autofit.png') })
    log('screenshot rot-270-after-autofit.png (rotation should persist through auto-fit)')
  }

  await browser.close()
  log('done. screenshots in', OUT)
}

main().catch((e) => { console.error(e); process.exit(1) })
