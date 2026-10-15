import { createOverlayHost } from './host.js'
import { ACCENT, ACCENT_FILL, ACCENT_FILL_SOFT } from './theme.js'

const LABEL_HEIGHT = 20
const FLASH_MS = 1200

// Hover is transient — drawn translucent so it reads as "not yet committed".
// Lock (click) is solid: it stays put so the row's chip can be reached and
// the field stays selected while editing.
const HOVER_OPACITY = '0.55'

const labelCss = (background: string): string =>
  `position:fixed;display:none;height:${LABEL_HEIGHT}px;line-height:${LABEL_HEIGHT}px;` +
  `background:${background};color:#fff;padding:0 6px;border-radius:3px 3px 3px 0;` +
  'font:600 11px/20px system-ui,sans-serif;white-space:nowrap;max-width:60vw;' +
  'overflow:hidden;text-overflow:ellipsis;'

/** Positions a box + its label around `target`, viewport-relative. */
const positionBoxLabel = (
  box: HTMLDivElement,
  label: HTMLDivElement,
  target: OverlayHoverTarget,
): void => {
  const rect = target.element.getBoundingClientRect()
  box.style.display = 'block'
  box.style.left = `${rect.left}px`
  box.style.top = `${rect.top}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`

  label.style.display = 'block'
  label.textContent = target.label
  label.style.left = `${Math.max(0, rect.left)}px`
  const labelAbove = rect.top - LABEL_HEIGHT
  if (labelAbove >= 0) {
    label.style.top = `${labelAbove}px`
    label.style.borderRadius = '3px 3px 3px 0'
  } else {
    label.style.top = `${Math.max(0, rect.top)}px`
    label.style.borderRadius = '0 3px 3px 0'
  }
}

export type OverlayHoverTarget = {
  element: Element
  label: string
}

/**
 * Single fixed, pointer-events:none layer inside a shadow root hosted by
 * one element appended to <body>. Site CSS is never mutated and cannot style
 * the overlay; chips re-enable pointer events locally. The layer is
 * position:fixed so getBoundingClientRect viewport coords map 1:1 — no scroll
 * offset math, and Live Preview's iframe zoom scales everything together.
 */
export class OverlayRenderer {
  private box: HTMLDivElement | null = null
  private flashBox: HTMLDivElement | null = null
  private flashTarget: Element | null = null
  private flashTimer: null | ReturnType<typeof setTimeout> = null
  private host: HTMLElement | null = null
  private hoverTarget: OverlayHoverTarget | null = null
  private label: HTMLDivElement | null = null
  private layer: HTMLDivElement | null = null
  private lockedBox: HTMLDivElement | null = null
  private lockedLabel: HTMLDivElement | null = null
  private lockedResizeObserver: null | ResizeObserver = null
  private lockedTarget: OverlayHoverTarget | null = null
  private rafId: null | number = null
  private readonly refreshHooks = new Set<() => void>()
  private resizeObserver: null | ResizeObserver = null

  private readonly scheduleRefresh = (): void => {
    if (this.rafId !== null) {
      return
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      this.refresh()
    })
  }

  get mounted(): boolean {
    return this.layer !== null
  }

  /** The overlay layer element — sub-views (chips, indicators) append here. */
  get layerElement(): HTMLElement | null {
    return this.layer
  }

  /** Runs on every refresh (scroll/resize/hover changes) while mounted. */
  addRefreshHook(hook: () => void): () => void {
    this.refreshHooks.add(hook)
    return () => {
      this.refreshHooks.delete(hook)
    }
  }

  /**
   * Whether a node belongs to the overlay's own UI (chips, buttons, …).
   * Document-level events from the shadow tree are retargeted to the host.
   */
  layerContains(node: unknown): boolean {
    return (
      node instanceof Node &&
      this.layer !== null &&
      this.host !== null &&
      (node === this.host || this.layer.contains(node))
    )
  }

  mount(doc: Document = document): void {
    if (this.layer) {
      return
    }
    const { host, root } = createOverlayHost(doc)
    const layer = doc.createElement('div')
    layer.setAttribute('data-pve-layer', '')
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;'
    root.appendChild(layer)

    const box = doc.createElement('div')
    box.setAttribute('data-pve-hover-box', '')
    box.style.cssText =
      `position:fixed;display:none;box-sizing:border-box;border:2px solid ${ACCENT};` +
      `background:${ACCENT_FILL_SOFT};border-radius:2px;opacity:${HOVER_OPACITY};`
    layer.appendChild(box)

    const label = doc.createElement('div')
    label.setAttribute('data-pve-hover-label', '')
    label.style.cssText = labelCss(ACCENT) + `opacity:${HOVER_OPACITY};`
    layer.appendChild(label)

    const lockedBox = doc.createElement('div')
    lockedBox.setAttribute('data-pve-locked-box', '')
    lockedBox.style.cssText =
      `position:fixed;display:none;box-sizing:border-box;border:2px solid ${ACCENT};` +
      `background:${ACCENT_FILL};border-radius:2px;box-shadow:0 0 0 1px ${ACCENT_FILL};`
    layer.appendChild(lockedBox)

    const lockedLabel = doc.createElement('div')
    lockedLabel.setAttribute('data-pve-locked-label', '')
    lockedLabel.style.cssText = labelCss(ACCENT)
    layer.appendChild(lockedLabel)

    const flashBox = doc.createElement('div')
    flashBox.setAttribute('data-pve-flash-box', '')
    flashBox.style.cssText =
      `position:fixed;display:none;box-sizing:border-box;border:2px solid ${ACCENT};` +
      `background:${ACCENT_FILL};border-radius:2px;`
    layer.appendChild(flashBox)

    doc.body.appendChild(host)
    this.host = host
    this.layer = layer
    this.box = box
    this.label = label
    this.lockedBox = lockedBox
    this.lockedLabel = lockedLabel
    this.flashBox = flashBox

    const win = doc.defaultView ?? window
    win.addEventListener('resize', this.scheduleRefresh)
    doc.addEventListener('scroll', this.scheduleRefresh, { capture: true, passive: true })
  }

  /** Draws a temporary highlight (admin-side field focus → page element). */
  flash(element: Element): void {
    if (!this.flashBox) {
      return
    }
    this.flashTarget = element
    if (this.flashTimer !== null) {
      clearTimeout(this.flashTimer)
    }
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null
      this.flashTarget = null
      this.refresh()
    }, FLASH_MS)

    this.flashBox.style.display = 'block'
    if (typeof this.flashBox.animate === 'function') {
      this.flashBox.animate(
        [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }],
        { duration: FLASH_MS, easing: 'ease-out' },
      )
    }
    this.refresh()
  }

  refresh(): void {
    if (!this.box || !this.label || !this.lockedBox || !this.lockedLabel) {
      return
    }
    for (const hook of this.refreshHooks) {
      hook()
    }
    if (this.flashBox) {
      if (this.flashTarget?.isConnected) {
        const flashRect = this.flashTarget.getBoundingClientRect()
        this.flashBox.style.display = 'block'
        this.flashBox.style.left = `${flashRect.left}px`
        this.flashBox.style.top = `${flashRect.top}px`
        this.flashBox.style.width = `${flashRect.width}px`
        this.flashBox.style.height = `${flashRect.height}px`
      } else {
        this.flashBox.style.display = 'none'
      }
    }

    const locked = this.lockedTarget?.element.isConnected ? this.lockedTarget : null
    if (locked) {
      positionBoxLabel(this.lockedBox, this.lockedLabel, locked)
    } else {
      this.lockedBox.style.display = 'none'
      this.lockedLabel.style.display = 'none'
    }

    // Suppress the translucent hover on the locked element so it doesn't
    // double-draw over the solid box.
    const hover = this.hoverTarget?.element.isConnected ? this.hoverTarget : null
    if (hover && hover.element !== locked?.element) {
      positionBoxLabel(this.box, this.label, hover)
    } else {
      this.box.style.display = 'none'
      this.label.style.display = 'none'
    }
  }

  setHover(target: null | OverlayHoverTarget): void {
    if (this.hoverTarget?.element === target?.element && this.hoverTarget?.label === target?.label) {
      return
    }
    this.hoverTarget = target
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (target && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.scheduleRefresh)
      this.resizeObserver.observe(target.element)
    }
    this.refresh()
  }

  /** The persistent "selected" highlight after a click. */
  setLocked(target: null | OverlayHoverTarget): void {
    if (this.lockedTarget?.element === target?.element && this.lockedTarget?.label === target?.label) {
      return
    }
    this.lockedTarget = target
    this.lockedResizeObserver?.disconnect()
    this.lockedResizeObserver = null
    if (target && typeof ResizeObserver !== 'undefined') {
      this.lockedResizeObserver = new ResizeObserver(this.scheduleRefresh)
      this.lockedResizeObserver.observe(target.element)
    }
    this.refresh()
  }

  unmount(): void {
    if (!this.layer || !this.host) {
      return
    }
    const doc = this.host.ownerDocument
    const win = doc.defaultView ?? window
    win.removeEventListener('resize', this.scheduleRefresh)
    doc.removeEventListener('scroll', this.scheduleRefresh, { capture: true })
    if (this.rafId !== null) {
      ;(doc.defaultView ?? window).cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.lockedResizeObserver?.disconnect()
    this.lockedResizeObserver = null
    this.hoverTarget = null
    this.lockedTarget = null
    if (this.flashTimer !== null) {
      clearTimeout(this.flashTimer)
      this.flashTimer = null
    }
    this.flashTarget = null
    this.host.remove()
    this.host = null
    this.layer = null
    this.box = null
    this.label = null
    this.lockedBox = null
    this.lockedLabel = null
    this.flashBox = null
  }
}
