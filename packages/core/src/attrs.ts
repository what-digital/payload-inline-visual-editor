/** Marks the overlay host element; its shadow root contains SDK UI, never site content. */
export const PVE_OVERLAY_ATTR = 'data-pve-overlay'

export const PVE_ATTR = {
  blockType: 'data-pve-block-type',
  container: 'data-pve-container',
  field: 'data-pve-field',
  row: 'data-pve-row',
  scope: 'data-pve-scope',
} as const

export type PveScopeRef = { collection: string; id?: null | number | string } | { global: string }

export type PveAttrRecord = Record<string, string>

/**
 * `id`/`blockType` accept the nullable shapes Payload's generated types use
 * (`id?: string | null`), so rows can be passed straight through. A missing id
 * at runtime degrades the row to a plain field (with a dev-mode warning) —
 * block operations need the stable row id.
 */
export type PveRowRef = {
  blockType?: null | string
  id: null | string | undefined
}

export const serializeScope = (scope: PveScopeRef): string => {
  if ('global' in scope) {
    return `global:${scope.global}`
  }
  return scope.id != null && scope.id !== ''
    ? `collection:${scope.collection};id:${scope.id}`
    : `collection:${scope.collection}`
}

export const parseScope = (value: string): null | PveScopeRef => {
  const parts: Record<string, string> = {}
  for (const segment of value.split(';')) {
    const separator = segment.indexOf(':')
    if (separator > 0) {
      parts[segment.slice(0, separator)] = segment.slice(separator + 1)
    }
  }
  if (parts.global) {
    return { global: parts.global }
  }
  if (parts.collection) {
    return parts.id ? { collection: parts.collection, id: parts.id } : { collection: parts.collection }
  }
  return null
}

// Keeps core free of @types/node; bundlers still statically replace process.env.NODE_ENV
declare const process: { env?: Record<string, string | undefined> } | undefined

const warnMissingRowId = (path: string): void => {
  if (typeof process === 'undefined' || process?.env?.NODE_ENV !== 'production') {
    console.warn(
      `[payload-inline-visual-editor] Row at "${path}" has no id — block operations will be disabled for it. ` +
        'A frontend transform likely dropped the row id; pass the id that Payload stores on every array/blocks row.',
    )
  }
}

export const pveAttr = {
  container: (path: string): PveAttrRecord => ({ [PVE_ATTR.container]: path }),
  field: (path: string): PveAttrRecord => ({ [PVE_ATTR.field]: path }),
  row: (path: string, row: PveRowRef): PveAttrRecord => {
    if (!row.id) {
      warnMissingRowId(path)
      return { [PVE_ATTR.field]: path }
    }
    const attrs: PveAttrRecord = { [PVE_ATTR.field]: path, [PVE_ATTR.row]: row.id }
    if (row.blockType) {
      attrs[PVE_ATTR.blockType] = row.blockType
    }
    return attrs
  },
  scope: (scope: PveScopeRef): PveAttrRecord => ({ [PVE_ATTR.scope]: serializeScope(scope) }),
}
