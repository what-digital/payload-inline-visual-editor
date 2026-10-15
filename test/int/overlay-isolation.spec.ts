// @vitest-environment jsdom
import { OverlayRenderer, RowChip } from '@payload-inline-visual-editor/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The overlay must not change the site's DOM, while all editor UI stays inside
// one open shadow root. Computed-style isolation is covered by the browser test
// because jsdom does not scope stylesheets to shadow trees.
const SITE = `
  <style>* { color: red !important } div { display: none !important }</style>
  <main class="site">
    <section id="hero" style="padding: 12px" data-pve-field="layout.0" data-pve-row="r1">
      <h1 id="heading" data-pve-field="layout.0.heading">Hello</h1>
    </section>
  </main>
`

const siteMarkup = (): string =>
  [...document.body.children]
    .filter((element) => !element.hasAttribute('data-pve-overlay'))
    .map((element) => element.outerHTML)
    .join('')

describe('overlay isolation', () => {
  let overlay: OverlayRenderer

  beforeEach(() => {
    document.body.innerHTML = SITE
    overlay = new OverlayRenderer()
  })

  afterEach(() => {
    overlay.unmount()
  })

  it('adds exactly one host element to the site and nothing else', () => {
    const before = siteMarkup()
    const childCount = document.body.children.length

    overlay.mount()
    const hero = document.getElementById('hero')!
    overlay.setHover({ element: document.getElementById('heading')!, label: 'Heading' })
    overlay.setLocked({ element: hero, label: 'Hero' })
    overlay.flash(hero)

    expect(document.body.children.length).toBe(childCount + 1)
    expect(document.querySelectorAll('[data-pve-overlay]')).toHaveLength(1)
    expect(siteMarkup()).toBe(before)

    overlay.unmount()
    expect(document.body.innerHTML.trim()).toBe(SITE.trim())
  })

  it('keeps every overlay element in the shadow root, out of the site DOM', () => {
    overlay.mount()
    overlay.setLocked({ element: document.getElementById('hero')!, label: 'Hero' })
    const chip = new RowChip({ onAction: () => {}, onDragStart: () => {} })
    chip.mount(overlay.layerElement!)

    const host = document.querySelector('[data-pve-overlay]')!
    expect(host.shadowRoot).not.toBeNull()
    expect(host.children).toHaveLength(0)
    for (const selector of ['[data-pve-layer]', '[data-pve-locked-box]', '[data-pve-hover-box]', '[data-pve-chip]']) {
      expect(document.querySelector(selector)).toBeNull()
      expect(host.shadowRoot!.querySelector(selector)).not.toBeNull()
    }
    chip.unmount()
  })

  it('pins the host with inline !important styles that outrank site CSS', () => {
    overlay.mount()
    const host = document.querySelector<HTMLElement>('[data-pve-overlay]')!
    for (const [property, value] of [
      ['display', 'block'],
      ['position', 'fixed'],
      ['top', '0px'],
      ['left', '0px'],
      ['pointer-events', 'none'],
      ['z-index', '2147483000'],
    ]) {
      expect(host.style.getPropertyValue(property).replace(/^0$/, '0px')).toBe(value)
      expect(host.style.getPropertyPriority(property)).toBe('important')
    }
  })

  it('treats the host and shadow-tree nodes as overlay UI, and site nodes as not', () => {
    overlay.mount()
    const host = document.querySelector('[data-pve-overlay]')!
    expect(overlay.layerContains(host)).toBe(true)
    expect(overlay.layerContains(overlay.layerElement)).toBe(true)
    expect(overlay.layerContains(document.getElementById('heading'))).toBe(false)
    expect(overlay.layerContains(document.body)).toBe(false)
  })
})
