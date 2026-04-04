import {
  explodeBom,
  matchVariantCondition,
  type BomDataLoader,
  type BomHeaderData,
  type BomLineData,
  type BomLineVariantData,
  type ExplosionInput,
} from '../lib/bom-explosion'

// ---------------------------------------------------------------------------
// Test Data Helpers
// ---------------------------------------------------------------------------

function makeHeader(overrides: Partial<BomHeaderData> & { id: string }): BomHeaderData {
  return { productId: 'prod-1', isPhantom: false, isActive: true, ...overrides }
}

function makeLine(overrides: Partial<BomLineData> & { id: string; bomHeaderId: string }): BomLineData {
  return {
    lineType: 'material',
    materialId: null,
    childBomHeaderId: null,
    netQuantity: null,
    grossQuantity: null,
    scrapPercentage: '0',
    uomId: null,
    variantCondition: null,
    operationTemplateId: null,
    sortOrder: 0,
    validFrom: null,
    validTo: null,
    isConsumable: false,
    ...overrides,
  }
}

function makeVariant(overrides: Partial<BomLineVariantData> & { id: string; bomLineId: string }): BomLineVariantData {
  return {
    variantId: null,
    variantCondition: null,
    quantityOverride: null,
    materialOverrideId: null,
    unitOverrideId: null,
    ...overrides,
  }
}

function createLoader(
  headers: BomHeaderData[],
  lines: BomLineData[],
  variants: BomLineVariantData[] = [],
): BomDataLoader {
  return {
    async loadHeader(id) {
      return headers.find((h) => h.id === id) ?? null
    },
    async loadLines(bomHeaderId) {
      return lines
        .filter((l) => l.bomHeaderId === bomHeaderId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    },
    async loadLineVariants(lineIds) {
      return variants.filter((v) => lineIds.includes(v.bomLineId))
    },
  }
}

function defaultInput(bomHeaderId: string, overrides?: Partial<ExplosionInput>): ExplosionInput {
  return {
    bomHeaderId,
    variantConditions: {},
    effectiveDate: new Date('2026-06-01'),
    maxDepth: 10,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests: matchVariantCondition
// ---------------------------------------------------------------------------

describe('matchVariantCondition', () => {
  it('matches single key with matching value', () => {
    expect(matchVariantCondition({ seat_type: ['SD01', 'SD02'] }, { seat_type: ['SD01'] })).toBe(true)
  })

  it('rejects single key with non-matching value', () => {
    expect(matchVariantCondition({ seat_type: ['SD01', 'SD02'] }, { seat_type: ['SD03'] })).toBe(false)
  })

  it('matches multiple keys (AND semantics)', () => {
    expect(matchVariantCondition(
      { seat_type: ['SD04'], fabric_group: ['premium', 'standard'] },
      { seat_type: ['SD04'], fabric_group: ['premium'] },
    )).toBe(true)
  })

  it('rejects when one key does not match (AND)', () => {
    expect(matchVariantCondition(
      { seat_type: ['SD04'], fabric_group: ['premium'] },
      { seat_type: ['SD04'], fabric_group: ['economy'] },
    )).toBe(false)
  })

  it('handles negation — excludes matching values', () => {
    expect(matchVariantCondition(
      { seat_type: { not: ['SD04'] } },
      { seat_type: ['SD01'] },
    )).toBe(true)
  })

  it('handles negation — rejects negated value', () => {
    expect(matchVariantCondition(
      { seat_type: { not: ['SD04'] } },
      { seat_type: ['SD04'] },
    )).toBe(false)
  })

  it('returns false when input key is missing', () => {
    expect(matchVariantCondition(
      { seat_type: ['SD01'] },
      {},
    )).toBe(false)
  })

  it('returns true for empty condition (no keys)', () => {
    expect(matchVariantCondition({}, { seat_type: ['SD01'] })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: explodeBom
// ---------------------------------------------------------------------------

describe('explodeBom', () => {
  it('explodes a simple flat BOM', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', materialId: 'mat-1', netQuantity: '2.5', uomId: 'uom-szt' }),
      makeLine({ id: 'line-2', bomHeaderId: 'bom-1', materialId: 'mat-2', netQuantity: '1', uomId: 'uom-m', sortOrder: 1 }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-1'), loader)

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].materialId).toBe('mat-1')
    expect(result.lines[0].quantity).toBe(2.5)
    expect(result.lines[1].materialId).toBe('mat-2')
    expect(result.depth).toBe(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('skips lines with null materialId and warns', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', materialId: null, netQuantity: '1' }),
      makeLine({ id: 'line-2', bomHeaderId: 'bom-1', materialId: 'mat-2', netQuantity: '3' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-1'), loader)

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].materialId).toBe('mat-2')
    expect(result.warnings).toContain('Line line-1 has null material_id — skipped')
  })

  it('handles empty BOM (no lines)', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const loader = createLoader(headers, [])
    const result = await explodeBom(defaultInput('bom-1'), loader)

    expect(result.lines).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('skips inactive BOM', async () => {
    const headers = [makeHeader({ id: 'bom-1', isActive: false })]
    const lines = [makeLine({ id: 'line-1', bomHeaderId: 'bom-1', materialId: 'mat-1', netQuantity: '1' })]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-1'), loader)

    expect(result.lines).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('inactive'))).toBe(true)
  })

  it('filters lines by date-effective range', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', materialId: 'mat-1', netQuantity: '1', validFrom: new Date('2026-01-01'), validTo: new Date('2026-05-31') }),
      makeLine({ id: 'line-2', bomHeaderId: 'bom-1', materialId: 'mat-2', netQuantity: '1', validFrom: new Date('2026-06-01'), validTo: new Date('2026-12-31'), sortOrder: 1 }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-1', { effectiveDate: new Date('2026-06-15') }), loader)

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].materialId).toBe('mat-2')
  })

  it('filters lines by variant condition', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-common', bomHeaderId: 'bom-1', materialId: 'mat-frame', netQuantity: '1' }),
      makeLine({ id: 'line-padded', bomHeaderId: 'bom-1', materialId: 'mat-padding', netQuantity: '2', variantCondition: { seat_type: ['padded'] }, sortOrder: 1 }),
      makeLine({ id: 'line-flat', bomHeaderId: 'bom-1', materialId: 'mat-flat', netQuantity: '1', variantCondition: { seat_type: ['flat'] }, sortOrder: 2 }),
    ]
    const loader = createLoader(headers, lines)

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { seat_type: ['padded'] } }),
      loader,
    )

    expect(result.lines).toHaveLength(2)
    expect(result.lines.map((l) => l.materialId)).toEqual(['mat-frame', 'mat-padding'])
  })

  it('applies BomLineVariant quantity override', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', materialId: 'mat-fabric', netQuantity: '5', uomId: 'uom-m' }),
    ]
    const variants = [
      makeVariant({
        id: 'v-1', bomLineId: 'line-1',
        variantCondition: { cushion: ['yes'] },
        quantityOverride: '8',
      }),
    ]
    const loader = createLoader(headers, lines, variants)

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { cushion: ['yes'] } }),
      loader,
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].quantity).toBe(8)
  })

  it('applies BomLineVariant material override', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', materialId: 'mat-standard', netQuantity: '1' }),
    ]
    const variants = [
      makeVariant({
        id: 'v-1', bomLineId: 'line-1',
        variantCondition: { grade: ['premium'] },
        materialOverrideId: 'mat-premium',
      }),
    ]
    const loader = createLoader(headers, lines, variants)

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { grade: ['premium'] } }),
      loader,
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].materialId).toBe('mat-premium')
  })

  it('handles phantom BOM pass-through', async () => {
    const headers = [
      makeHeader({ id: 'bom-parent', productId: 'prod-sofa' }),
      makeHeader({ id: 'bom-phantom', productId: 'prod-frame', isPhantom: true }),
    ]
    const lines = [
      makeLine({ id: 'line-child', bomHeaderId: 'bom-parent', lineType: 'semi_product', childBomHeaderId: 'bom-phantom' }),
      makeLine({ id: 'line-wood', bomHeaderId: 'bom-phantom', materialId: 'mat-wood', netQuantity: '4' }),
      makeLine({ id: 'line-screws', bomHeaderId: 'bom-phantom', materialId: 'mat-screws', netQuantity: '20', sortOrder: 1 }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-parent'), loader)

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].materialId).toBe('mat-wood')
    expect(result.lines[0].isPhantomPassThrough).toBe(true)
    expect(result.lines[1].materialId).toBe('mat-screws')
    expect(result.lines[1].isPhantomPassThrough).toBe(true)
  })

  it('handles non-phantom child BOM (sub-assembly)', async () => {
    const headers = [
      makeHeader({ id: 'bom-parent', productId: 'prod-sofa' }),
      makeHeader({ id: 'bom-child', productId: 'prod-seat' }),
    ]
    const lines = [
      makeLine({ id: 'line-seat', bomHeaderId: 'bom-parent', lineType: 'semi_product', childBomHeaderId: 'bom-child', materialId: 'prod-seat', netQuantity: '1' }),
      makeLine({ id: 'line-foam', bomHeaderId: 'bom-child', materialId: 'mat-foam', netQuantity: '2' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-parent'), loader)

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].level).toBe(0)
    expect(result.lines[0].materialId).toBe('prod-seat')
    expect(result.lines[1].level).toBe(1)
    expect(result.lines[1].materialId).toBe('mat-foam')
    expect(result.depth).toBe(1)
  })

  it('handles multi-level BOM (3 levels)', async () => {
    const headers = [
      makeHeader({ id: 'bom-L0' }),
      makeHeader({ id: 'bom-L1' }),
      makeHeader({ id: 'bom-L2' }),
    ]
    const lines = [
      makeLine({ id: 'l0-sub', bomHeaderId: 'bom-L0', lineType: 'semi_product', childBomHeaderId: 'bom-L1', materialId: 'sub-1', netQuantity: '1' }),
      makeLine({ id: 'l1-sub', bomHeaderId: 'bom-L1', lineType: 'semi_product', childBomHeaderId: 'bom-L2', materialId: 'sub-2', netQuantity: '1' }),
      makeLine({ id: 'l2-mat', bomHeaderId: 'bom-L2', materialId: 'mat-raw', netQuantity: '10' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-L0'), loader)

    expect(result.lines).toHaveLength(3)
    expect(result.depth).toBe(2)
  })

  it('detects circular reference and warns', async () => {
    const headers = [
      makeHeader({ id: 'bom-A' }),
      makeHeader({ id: 'bom-B' }),
    ]
    const lines = [
      makeLine({ id: 'line-A', bomHeaderId: 'bom-A', lineType: 'semi_product', childBomHeaderId: 'bom-B', materialId: 'x', netQuantity: '1' }),
      makeLine({ id: 'line-B', bomHeaderId: 'bom-B', lineType: 'semi_product', childBomHeaderId: 'bom-A', materialId: 'y', netQuantity: '1' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-A'), loader)

    expect(result.warnings.some((w) => w.includes('Circular reference') || w.includes('already visited'))).toBe(true)
  })

  it('respects max depth limit', async () => {
    const headers = Array.from({ length: 5 }, (_, i) => makeHeader({ id: `bom-${i}` }))
    const lines = Array.from({ length: 4 }, (_, i) =>
      makeLine({
        id: `line-${i}`, bomHeaderId: `bom-${i}`,
        lineType: 'semi_product', childBomHeaderId: `bom-${i + 1}`,
        materialId: `sub-${i}`, netQuantity: '1',
      }),
    )
    lines.push(makeLine({ id: 'line-leaf', bomHeaderId: 'bom-4', materialId: 'mat-leaf', netQuantity: '1' }))

    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-0', { maxDepth: 2 }), loader)

    expect(result.warnings.some((w) => w.includes('Max depth'))).toBe(true)
  })

  it('computes gross quantity with scrap percentage', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', materialId: 'mat-1', netQuantity: '10', scrapPercentage: '10' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-1'), loader)

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].quantity).toBe(10)
    expect(result.lines[0].scrapPercentage).toBe(10)
    expect(result.lines[0].grossQuantity).toBeCloseTo(11.111, 2)
  })

  it('warns when BOM header not found', async () => {
    const loader = createLoader([], [])
    const result = await explodeBom(defaultInput('nonexistent'), loader)

    expect(result.lines).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('not found'))).toBe(true)
  })
})
