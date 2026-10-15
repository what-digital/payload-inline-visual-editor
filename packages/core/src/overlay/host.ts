import { PVE_OVERLAY_ATTR } from '../attrs.js'

// The host is the overlay's only element in the site's DOM; everything else
// lives in its shadow root. Inline !important styles protect the host itself
// from broad site rules such as *, div, or [data-pve-overlay] selectors.
const HOST_STYLE: readonly (readonly [string, string])[] = [
  ['all', 'initial'],
  ['display', 'block'],
  ['position', 'fixed'],
  ['top', '0'],
  ['right', '0'],
  ['bottom', '0'],
  ['left', '0'],
  ['pointer-events', 'none'],
  ['z-index', '2147483000'],
]

export interface OverlayHost {
  host: HTMLElement
  root: ShadowRoot
}

/** Creates the overlay host and its open shadow root; the caller appends the host. */
export const createOverlayHost = (doc: Document): OverlayHost => {
  const host = doc.createElement('div')
  host.setAttribute(PVE_OVERLAY_ATTR, '')
  for (const [property, value] of HOST_STYLE) {
    host.style.setProperty(property, value, 'important')
  }
  const root = host.attachShadow({ mode: 'open' })
  return { host, root }
}
