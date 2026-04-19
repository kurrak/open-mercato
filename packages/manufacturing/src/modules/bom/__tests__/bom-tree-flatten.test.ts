import {
  buildDisplayRows,
  type MinimalBomLine,
} from '../lib/bom-tree-flatten'

type TestLine = MinimalBomLine & { sort_order: number }

function line(
  id: string,
  opts: Partial<Omit<TestLine, 'id'>> = {},
): TestLine {
  return {
    id,
    bom_header_id: opts.bom_header_id ?? 'h1',
    line_type: opts.line_type ?? 'material',
    child_bom_header_id: opts.child_bom_header_id ?? null,
    sort_order: opts.sort_order ?? 0,
    ...opts,
  }
}

describe('buildDisplayRows — top-level header', () => {
  it('emits a line row per BomLine + a trailing add row', () => {
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [line('l1'), line('l2')],
      childLinesByHeader: new Map(),
      expandedChildrenIds: new Set(),
      expandedVariantsIds: new Set(),
    })
    expect(out.map((r) => r.type)).toEqual(['line', 'line', 'add'])
    expect(out[0]).toMatchObject({ type: 'line', depth: 0, line: { id: 'l1' }, isFirst: true, isLast: false, cycle: false })
    expect(out[1]).toMatchObject({ type: 'line', depth: 0, line: { id: 'l2' }, isFirst: false, isLast: true })
    expect(out[2]).toMatchObject({ type: 'add', depth: 0, bomHeaderId: 'h1', isEmptyHeader: false })
  })

  it('empty header → only the "+ Add first line" pseudo-row, marked isEmptyHeader', () => {
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [],
      childLinesByHeader: new Map(),
      expandedChildrenIds: new Set(),
      expandedVariantsIds: new Set(),
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'add', depth: 0, bomHeaderId: 'h1', isEmptyHeader: true })
  })
})

describe('buildDisplayRows — variants expansion', () => {
  it('emits a variants row AFTER the line it belongs to', () => {
    const l1 = line('l1')
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [l1, line('l2')],
      childLinesByHeader: new Map(),
      expandedChildrenIds: new Set(),
      expandedVariantsIds: new Set(['l1']),
    })
    expect(out.map((r) => r.type)).toEqual(['line', 'variants', 'line', 'add'])
    expect(out[1]).toMatchObject({ type: 'variants', depth: 0, line: { id: 'l1' } })
  })

  it('variants row inherits the line\'s depth', () => {
    const parent = line('parent', { line_type: 'semi_product', child_bom_header_id: 'h2' })
    const child = line('child', { bom_header_id: 'h2' })
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [parent],
      childLinesByHeader: new Map([['h2', [child]]]),
      expandedChildrenIds: new Set(['parent']),
      expandedVariantsIds: new Set(['child']),
    })
    const variantsRow = out.find((r) => r.type === 'variants')
    expect(variantsRow).toBeDefined()
    expect(variantsRow!.depth).toBe(1)
  })
})

describe('buildDisplayRows — recursive drill-in', () => {
  it('drills into an expanded semi_product line and emits nested rows at depth+1', () => {
    const parent = line('parent', { line_type: 'semi_product', child_bom_header_id: 'h2' })
    const child1 = line('c1', { bom_header_id: 'h2' })
    const child2 = line('c2', { bom_header_id: 'h2' })
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [parent],
      childLinesByHeader: new Map([['h2', [child1, child2]]]),
      expandedChildrenIds: new Set(['parent']),
      expandedVariantsIds: new Set(),
    })
    expect(out.map((r) => r.type)).toEqual(['line', 'line', 'line', 'add', 'add'])
    expect(out[0]).toMatchObject({ line: { id: 'parent' }, depth: 0 })
    expect(out[1]).toMatchObject({ line: { id: 'c1' }, depth: 1, bomHeaderId: 'h2', isFirst: true, isLast: false })
    expect(out[2]).toMatchObject({ line: { id: 'c2' }, depth: 1, bomHeaderId: 'h2', isFirst: false, isLast: true })
    // Inner add row (for h2) first, then outer add row (for h1) — both rendered:
    expect(out[3]).toMatchObject({ type: 'add', depth: 1, bomHeaderId: 'h2', isEmptyHeader: false })
    expect(out[4]).toMatchObject({ type: 'add', depth: 0, bomHeaderId: 'h1', isEmptyHeader: false })
  })

  it('non-expanded semi_product line does NOT emit nested rows', () => {
    const parent = line('parent', { line_type: 'semi_product', child_bom_header_id: 'h2' })
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [parent],
      childLinesByHeader: new Map([['h2', [line('c1', { bom_header_id: 'h2' })]]]),
      expandedChildrenIds: new Set(), // not expanded
      expandedVariantsIds: new Set(),
    })
    expect(out.map((r) => r.type)).toEqual(['line', 'add'])
  })

  it('expanded semi_product WITHOUT loaded child lines skips the nested block (loading state)', () => {
    const parent = line('parent', { line_type: 'semi_product', child_bom_header_id: 'h2' })
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [parent],
      childLinesByHeader: new Map(), // child not loaded yet
      expandedChildrenIds: new Set(['parent']),
      expandedVariantsIds: new Set(),
    })
    expect(out.map((r) => r.type)).toEqual(['line', 'add'])
  })

  it('material line with expand flag set is ignored (semi_product gating)', () => {
    const l1 = line('m1', { line_type: 'material', child_bom_header_id: 'h2' })
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [l1],
      childLinesByHeader: new Map([['h2', [line('c1')]]]),
      expandedChildrenIds: new Set(['m1']),
      expandedVariantsIds: new Set(),
    })
    expect(out.map((r) => r.type)).toEqual(['line', 'add'])
  })
})

describe('buildDisplayRows — cycle guard', () => {
  it('sets cycle: true when child_bom_header_id matches the current branch ancestor', () => {
    // h1 → parent (semi_product pointing at h1 — direct self-cycle)
    const parent = line('parent', { line_type: 'semi_product', child_bom_header_id: 'h1' })
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [parent],
      childLinesByHeader: new Map([['h1', [parent]]]),
      expandedChildrenIds: new Set(['parent']),
      expandedVariantsIds: new Set(),
    })
    // Should NOT recurse into h1 (already in ancestor chain); just emit
    // the parent with cycle flag + the trailing add row for h1.
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ type: 'line', cycle: true, line: { id: 'parent' } })
    expect(out[1]).toMatchObject({ type: 'add' })
  })

  it('sets cycle: true for indirect cycles (grandchild references a grandparent)', () => {
    // h1 → a (→ h2) ; h2 → b (→ h1)
    const a = line('a', { line_type: 'semi_product', child_bom_header_id: 'h2', bom_header_id: 'h1' })
    const b = line('b', { line_type: 'semi_product', child_bom_header_id: 'h1', bom_header_id: 'h2' })
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [a],
      childLinesByHeader: new Map([['h2', [b]]]),
      expandedChildrenIds: new Set(['a', 'b']),
      expandedVariantsIds: new Set(),
    })
    // a (normal), b (cycle — child_bom_header_id = h1 which is the root)
    const bRow = out.find((r) => r.type === 'line' && r.line.id === 'b')
    expect(bRow).toBeDefined()
    expect((bRow as { cycle: boolean }).cycle).toBe(true)
  })

  it('does not mark cycle for sibling branches that reference the same header', () => {
    // h1 → a (→ h2) ; h1 → b (→ h2) — both siblings reference h2 but neither
    // is a cycle; each branch has its own ancestor chain.
    const a = line('a', { line_type: 'semi_product', child_bom_header_id: 'h2', bom_header_id: 'h1', sort_order: 0 })
    const b = line('b', { line_type: 'semi_product', child_bom_header_id: 'h2', bom_header_id: 'h1', sort_order: 1 })
    const c = line('c', { bom_header_id: 'h2' })
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [a, b],
      childLinesByHeader: new Map([['h2', [c]]]),
      expandedChildrenIds: new Set(['a', 'b']),
      expandedVariantsIds: new Set(),
    })
    const aRow = out.find((r) => r.type === 'line' && r.line.id === 'a') as { cycle: boolean } | undefined
    const bRow = out.find((r) => r.type === 'line' && r.line.id === 'b') as { cycle: boolean } | undefined
    expect(aRow?.cycle).toBe(false)
    expect(bRow?.cycle).toBe(false)
  })
})

describe('buildDisplayRows — isFirst / isLast sibling markers', () => {
  it('marks only the first sibling as isFirst and only the last as isLast', () => {
    const rows = [line('l1'), line('l2'), line('l3')]
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: rows,
      childLinesByHeader: new Map(),
      expandedChildrenIds: new Set(),
      expandedVariantsIds: new Set(),
    })
    const lineRows = out.filter((r) => r.type === 'line')
    expect(lineRows.map((r) => ({ id: r.line.id, first: r.isFirst, last: r.isLast }))).toEqual([
      { id: 'l1', first: true, last: false },
      { id: 'l2', first: false, last: false },
      { id: 'l3', first: false, last: true },
    ])
  })

  it('a single sibling is both isFirst AND isLast', () => {
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [line('solo')],
      childLinesByHeader: new Map(),
      expandedChildrenIds: new Set(),
      expandedVariantsIds: new Set(),
    })
    expect(out[0]).toMatchObject({ type: 'line', isFirst: true, isLast: true })
  })

  it('isFirst / isLast are scoped per BomHeader — nested children have their own markers', () => {
    const p = line('p', { line_type: 'semi_product', child_bom_header_id: 'h2' })
    const c1 = line('c1', { bom_header_id: 'h2' })
    const c2 = line('c2', { bom_header_id: 'h2' })
    const out = buildDisplayRows({
      topLevelHeaderId: 'h1',
      topLevelLines: [p, line('t2')],
      childLinesByHeader: new Map([['h2', [c1, c2]]]),
      expandedChildrenIds: new Set(['p']),
      expandedVariantsIds: new Set(),
    })
    const pRow = out.find((r) => r.type === 'line' && r.line.id === 'p') as { isFirst: boolean; isLast: boolean }
    const c1Row = out.find((r) => r.type === 'line' && r.line.id === 'c1') as { isFirst: boolean; isLast: boolean }
    const c2Row = out.find((r) => r.type === 'line' && r.line.id === 'c2') as { isFirst: boolean; isLast: boolean }
    const t2Row = out.find((r) => r.type === 'line' && r.line.id === 't2') as { isFirst: boolean; isLast: boolean }
    expect(pRow).toMatchObject({ isFirst: true, isLast: false })  // first of h1
    expect(c1Row).toMatchObject({ isFirst: true, isLast: false }) // first of h2
    expect(c2Row).toMatchObject({ isFirst: false, isLast: true }) // last of h2
    expect(t2Row).toMatchObject({ isFirst: false, isLast: true }) // last of h1
  })
})
