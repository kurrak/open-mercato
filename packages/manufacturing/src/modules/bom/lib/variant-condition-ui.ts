/**
 * Pure transforms between the persisted `variant_condition` shape and the
 * internal representations consumed by the BOM-side shared UI components
 * (see spec b §Shared VariantCondition components).
 *
 *   persisted:  Record<string, string[] | { not: string[] }> | null
 *   row:        { rowId: string, key: string, operator: 'in'|'not_in', values: string[] }  (editor)
 *   entry:      { key: string, operator: 'in'|'not_in', values: string[] }                 (display)
 *
 * These helpers have no React dependency and no UI imports — keeping them
 * here lets us unit-test them under the existing node-env jest config.
 */

export type VariantConditionValue = Record<string, string[] | { not: string[] }> | null

export type VariantConditionOperator = 'in' | 'not_in'

export type VariantConditionEditorRow = {
  rowId: string
  key: string
  operator: VariantConditionOperator
  values: string[]
}

export type VariantConditionDisplayEntry = {
  key: string
  operator: VariantConditionOperator
  values: string[]
}

type RowIdAllocator = () => string

export function parseDisplayEntries(value: VariantConditionValue): VariantConditionDisplayEntry[] {
  if (!value || typeof value !== 'object') return []
  const out: VariantConditionDisplayEntry[] = []
  for (const [key, raw] of Object.entries(value)) {
    if (Array.isArray(raw)) {
      out.push({
        key,
        operator: 'in',
        values: raw.filter((v): v is string => typeof v === 'string'),
      })
      continue
    }
    if (
      raw &&
      typeof raw === 'object' &&
      'not' in raw &&
      Array.isArray((raw as { not: unknown }).not)
    ) {
      const notValues = (raw as { not: unknown[] }).not.filter((v): v is string => typeof v === 'string')
      out.push({ key, operator: 'not_in', values: notValues })
    }
  }
  return out
}

export function parseEditorRows(
  value: VariantConditionValue,
  allocateRowId: RowIdAllocator,
): VariantConditionEditorRow[] {
  return parseDisplayEntries(value).map((entry) => ({
    rowId: allocateRowId(),
    ...entry,
  }))
}

/**
 * Convert editor rows back to the persisted shape. Rows whose key is empty
 * (user mid-edit) are dropped silently so authoring-in-progress state
 * doesn't leak into the saved condition. Duplicate keys keep the last
 * row's values — matches Object.fromEntries() semantics.
 */
export function serializeEditorRows(
  rows: readonly VariantConditionEditorRow[],
): Record<string, string[] | { not: string[] }> {
  const out: Record<string, string[] | { not: string[] }> = {}
  for (const row of rows) {
    if (!row.key.trim()) continue
    out[row.key] = row.operator === 'not_in' ? { not: row.values } : row.values
  }
  return out
}

/**
 * Partition the UUIDs referenced across all display entries by the
 * `attribute_type` of the matching ConfigAttribute. Keys without a matching
 * attribute (unknown keys on semi-product authoring) are ignored —
 * VariantConditionBadges renders them as raw strings.
 */
export function collectCatalogIds(
  entries: readonly VariantConditionDisplayEntry[],
  attributesByKey: ReadonlyMap<string, { attributeType: string }>,
): { productIds: string[]; variantIds: string[] } {
  const productIds: string[] = []
  const variantIds: string[] = []
  for (const entry of entries) {
    const meta = attributesByKey.get(entry.key)
    if (!meta) continue
    if (meta.attributeType === 'product') {
      productIds.push(...entry.values)
    } else if (meta.attributeType === 'product_variant') {
      variantIds.push(...entry.values)
    }
  }
  return { productIds, variantIds }
}

/**
 * Normalize a persisted variantCondition payload to the shape the editor
 * expects. Routes through `parseDisplayEntries` so only well-formed
 * entries survive — a corrupt nested shape (non-array under a key, wrong
 * `{not: …}` payload) is filtered out rather than crashing the editor on
 * mount. The server Zod still validates on save; this is a client-side
 * defense-in-depth.
 *
 * Promoted from `BomLineFormConfig.ts` — both `BomLineFormConfig` and
 * `BomLineVariantFormConfig` consume it from this neutral module to
 * avoid sibling-coupling between the two form configs.
 */
export function normalizeVariantCondition(raw: unknown): Record<string, string[] | { not: string[] }> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = parseDisplayEntries(raw as Record<string, string[] | { not: string[] }>)
  if (entries.length === 0) return null
  const out: Record<string, string[] | { not: string[] }> = {}
  for (const entry of entries) {
    out[entry.key] = entry.operator === 'not_in' ? { not: entry.values } : entry.values
  }
  return out
}
