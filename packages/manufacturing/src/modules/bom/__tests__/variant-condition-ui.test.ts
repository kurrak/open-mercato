import {
  parseDisplayEntries,
  parseEditorRows,
  serializeEditorRows,
  collectCatalogIds,
  type VariantConditionValue,
  type VariantConditionEditorRow,
} from '../lib/variant-condition-ui'

describe('parseDisplayEntries', () => {
  it('returns empty array for null / undefined / empty object', () => {
    expect(parseDisplayEntries(null)).toEqual([])
    expect(parseDisplayEntries({} as VariantConditionValue)).toEqual([])
  })

  it('parses inclusive form (array) as operator="in"', () => {
    const out = parseDisplayEntries({ fabric: ['SD01', 'SD02'] })
    expect(out).toEqual([{ key: 'fabric', operator: 'in', values: ['SD01', 'SD02'] }])
  })

  it('parses negation form ({not: [...]}) as operator="not_in"', () => {
    const out = parseDisplayEntries({ grade: { not: ['economy'] } })
    expect(out).toEqual([{ key: 'grade', operator: 'not_in', values: ['economy'] }])
  })

  it('drops malformed shapes (scalar, boolean, missing not key)', () => {
    const out = parseDisplayEntries({
      scalar: 'x' as unknown as string[],
      bool: true as unknown as string[],
      weird: { unexpectedKey: ['v'] } as unknown as { not: string[] },
    })
    expect(out).toEqual([])
  })

  it('filters non-string values out of both shapes (defensive)', () => {
    const out = parseDisplayEntries({
      fabric: ['SD01', 42 as unknown as string, null as unknown as string, 'SD02'],
      grade: { not: ['premium', 1 as unknown as string] },
    })
    expect(out).toEqual([
      { key: 'fabric', operator: 'in', values: ['SD01', 'SD02'] },
      { key: 'grade', operator: 'not_in', values: ['premium'] },
    ])
  })

  it('preserves ordering for Object.entries iteration stability', () => {
    const out = parseDisplayEntries({ a: ['1'], b: ['2'], c: ['3'] })
    expect(out.map((e) => e.key)).toEqual(['a', 'b', 'c'])
  })
})

describe('parseEditorRows', () => {
  it('allocates a unique rowId for each row', () => {
    let counter = 0
    const allocate = () => {
      counter += 1
      return `r-${counter}`
    }
    const rows = parseEditorRows({ fabric: ['SD01'], grade: { not: ['e'] } }, allocate)
    expect(rows.map((r) => r.rowId)).toEqual(['r-1', 'r-2'])
    expect(rows.map((r) => r.key)).toEqual(['fabric', 'grade'])
    expect(rows.map((r) => r.operator)).toEqual(['in', 'not_in'])
  })
})

describe('serializeEditorRows', () => {
  const allocate = (n: number) => (): string => `r-${n}`

  it('converts inclusive rows to arrays', () => {
    const rows: VariantConditionEditorRow[] = [
      { rowId: 'r-1', key: 'fabric', operator: 'in', values: ['SD01', 'SD02'] },
    ]
    expect(serializeEditorRows(rows)).toEqual({ fabric: ['SD01', 'SD02'] })
  })

  it('converts not_in rows to {not: [...]} shape', () => {
    const rows: VariantConditionEditorRow[] = [
      { rowId: 'r-1', key: 'grade', operator: 'not_in', values: ['economy'] },
    ]
    expect(serializeEditorRows(rows)).toEqual({ grade: { not: ['economy'] } })
  })

  it('drops rows whose key is empty or whitespace-only (authoring in-progress)', () => {
    const rows: VariantConditionEditorRow[] = [
      { rowId: 'r-1', key: '', operator: 'in', values: ['orphan'] },
      { rowId: 'r-2', key: '   ', operator: 'in', values: ['orphan2'] },
      { rowId: 'r-3', key: 'kept', operator: 'in', values: ['x'] },
    ]
    expect(serializeEditorRows(rows)).toEqual({ kept: ['x'] })
  })

  it('keeps rows with empty values array (explicit "matches nothing")', () => {
    const rows: VariantConditionEditorRow[] = [
      { rowId: 'r-1', key: 'fabric', operator: 'in', values: [] },
    ]
    expect(serializeEditorRows(rows)).toEqual({ fabric: [] })
  })

  it('resolves duplicate keys to the last row (Object.fromEntries semantics)', () => {
    const rows: VariantConditionEditorRow[] = [
      { rowId: 'r-1', key: 'fabric', operator: 'in', values: ['a'] },
      { rowId: 'r-2', key: 'fabric', operator: 'not_in', values: ['b'] },
    ]
    expect(serializeEditorRows(rows)).toEqual({ fabric: { not: ['b'] } })
  })

  it('returns empty object for empty rows array', () => {
    expect(serializeEditorRows([])).toEqual({})
  })

  // Round-trip coverage — parse → serialize should be the identity for
  // well-formed inputs. This guards against future refactors that
  // inadvertently diverge the two transforms.
  it('round-trips parseEditorRows → serializeEditorRows', () => {
    const original = { fabric: ['SD01', 'SD02'], grade: { not: ['economy'] } }
    const rows = parseEditorRows(original, allocate(0))
    expect(serializeEditorRows(rows)).toEqual(original)
  })
})

describe('collectCatalogIds', () => {
  const attributesByKey = new Map<string, { attributeType: string }>([
    ['fabric', { attributeType: 'product_variant' }],
    ['legs', { attributeType: 'product' }],
    ['color', { attributeType: 'enum' }],
  ])

  it('partitions UUIDs by attribute_type (product / product_variant)', () => {
    const entries = parseDisplayEntries({
      fabric: ['variant-uuid-1', 'variant-uuid-2'],
      legs: ['product-uuid-1'],
      color: ['red'], // enum — not a catalog UUID, ignored
    })
    const out = collectCatalogIds(entries, attributesByKey)
    expect(out.productIds).toEqual(['product-uuid-1'])
    expect(out.variantIds).toEqual(['variant-uuid-1', 'variant-uuid-2'])
  })

  it('ignores entries whose key has no matching ConfigAttribute (unknown keys)', () => {
    const entries = parseDisplayEntries({ unknownKey: ['someUuid'] })
    const out = collectCatalogIds(entries, attributesByKey)
    expect(out.productIds).toEqual([])
    expect(out.variantIds).toEqual([])
  })

  it('collects UUIDs from both operator forms (in + not_in)', () => {
    const entries = parseDisplayEntries({
      fabric: { not: ['variant-uuid-excluded'] },
      legs: ['product-uuid-x'],
    })
    const out = collectCatalogIds(entries, attributesByKey)
    expect(out.variantIds).toEqual(['variant-uuid-excluded'])
    expect(out.productIds).toEqual(['product-uuid-x'])
  })

  it('returns empty arrays for empty entries', () => {
    const out = collectCatalogIds([], attributesByKey)
    expect(out.productIds).toEqual([])
    expect(out.variantIds).toEqual([])
  })
})
