import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Real-browser coverage for both sides of the isolation boundary: mounting the
// editor must not change site styles, and hostile site CSS must not style the
// overlay. The built core SDK is served directly from packages/core/dist.
const ORIGIN = 'http://pve-isolation.test'
const CORE_DIST = join(import.meta.dirname, '..', '..', 'packages', 'core', 'dist')

const HOSTILE_CSS = `
  * { color: rgb(255, 0, 0) !important; font-size: 40px !important; border: 5px solid rgb(0, 255, 0) !important;
      opacity: 0.5 !important; box-sizing: content-box !important; }
  div { display: none !important; }
  [data-pve-overlay] { display: none !important; visibility: hidden !important; }
  body > * { pointer-events: auto !important; z-index: 1 !important; }
`

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>${HOSTILE_CSS}</style></head>
<body>
  <main>
    <section id="hero" data-pve-field="layout.0" data-pve-row="r1"><h1 id="heading">Hello</h1><p>Text</p></section>
    <section id="next" data-pve-field="layout.1" data-pve-row="r2"><p>More</p></section>
  </main>
  <script type="module">
    import { OverlayRenderer } from '/core/index.js'
    window.pveOverlay = new OverlayRenderer()
    window.pveReady = true
  </script>
</body></html>`

const siteStyles = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('main, main *')].map((element) => {
      const style = getComputedStyle(element)
      return [...style].map((property) => `${property}:${style.getPropertyValue(property)}`).join(';')
    }),
  )

const siteMarkup = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('main')?.outerHTML ?? '')

test.describe('overlay isolation (real browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${ORIGIN}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/core/')) {
        await route.fulfill({
          body: readFileSync(join(CORE_DIST, path.slice('/core/'.length))),
          contentType: 'text/javascript',
        })
        return
      }
      await route.fulfill({ body: PAGE, contentType: 'text/html' })
    })
    await page.goto(`${ORIGIN}/`)
    await page.waitForFunction(() => 'pveReady' in window)
  })

  test('selecting a block leaves the site DOM and computed styles unchanged', async ({ page }) => {
    const markupBefore = await siteMarkup(page)
    const stylesBefore = await siteStyles(page)

    await page.evaluate(() => {
      const overlay = Reflect.get(window, 'pveOverlay')
      const hero = document.getElementById('hero')
      overlay.mount()
      overlay.setHover({ element: document.getElementById('heading'), label: 'Heading' })
      overlay.setLocked({ element: hero, label: 'Hero' })
    })

    expect(await siteMarkup(page)).toBe(markupBefore)
    expect(await siteStyles(page)).toEqual(stylesBefore)
  })

  test('hostile site CSS does not reach the overlay', async ({ page }) => {
    await page.evaluate(() => {
      const overlay = Reflect.get(window, 'pveOverlay')
      overlay.mount()
      overlay.setLocked({ element: document.getElementById('hero'), label: 'Hero' })
    })

    const host = page.locator('[data-pve-overlay]')
    await expect(host).toHaveCSS('display', 'block')
    await expect(host).toHaveCSS('visibility', 'visible')
    await expect(host).toHaveCSS('opacity', '1')
    await expect(host).toHaveCSS('pointer-events', 'none')
    await expect(host).toHaveCSS('z-index', '2147483000')

    const box = page.locator('[data-pve-locked-box]')
    await expect(box).toBeVisible()
    await expect(box).toHaveCSS('border-top-color', 'rgb(21, 135, 186)')
    await expect(box).toHaveCSS('border-top-width', '2px')
    await expect(box).toHaveCSS('box-sizing', 'border-box')
    await expect(box).toHaveCSS('opacity', '1')

    const label = page.locator('[data-pve-locked-label]')
    await expect(label).toHaveText('Hero')
    await expect(label).toHaveCSS('font-size', '11px')
    await expect(label).toHaveCSS('color', 'rgb(255, 255, 255)')

    const heroBox = await page.locator('#hero').boundingBox()
    const lockedBox = await box.boundingBox()
    expect(lockedBox).toEqual(heroBox)
  })
})
