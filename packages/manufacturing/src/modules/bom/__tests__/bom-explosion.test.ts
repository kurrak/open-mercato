import {
  explodeBom,
  matchVariantCondition,
  warningsByLineId,
  type BomDataLoader,
  type BomHeaderData,
  type BomLineData,
  type BomLineVariantData,
  type ExplosionInput,
  type ExplosionContext,
  type ConfigAttributeData,
  type CatalogProductData,
  type CatalogProductVariantData,
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
    productId: null,
    productVariantId: null,
    productResolveKey: null,
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
    productOverrideId: null,
    productVariantOverrideId: null,
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

function emptyContext(): ExplosionContext {
  return {
    configAttributesByKey: new Map(),
    catalogProducts: new Map(),
    catalogProductVariants: new Map(),
  }
}

function makeContext(overrides?: {
  configAttributes?: ConfigAttributeData[]
  catalogProducts?: CatalogProductData[]
  catalogProductVariants?: CatalogProductVariantData[]
}): ExplosionContext {
  return {
    configAttributesByKey: new Map((overrides?.configAttributes ?? []).map((a) => [a.key, a])),
    catalogProducts: new Map((overrides?.catalogProducts ?? []).map((p) => [p.id, p])),
    catalogProductVariants: new Map((overrides?.catalogProductVariants ?? []).map((v) => [v.id, v])),
  }
}

// ---------------------------------------------------------------------------
// Tests: matchVariantCondition
// ---------------------------------------------------------------------------

describe('matchVariantCondition', () => {
  // Filter arrays stay as arrays on the line's variant_condition; the input
  // side is scalar per spec b 2026-04-17. The matcher does scalar-in-array
  // inclusion (and scalar-not-in-array for the 'not' form).

  it('matches single key when input value is in the filter array', () => {
    expect(matchVariantCondition({ seat_type: ['SD01', 'SD02'] }, { seat_type: 'SD01' })).toBe(true)
  })

  it('rejects single key when input value is not in the filter array', () => {
    expect(matchVariantCondition({ seat_type: ['SD01', 'SD02'] }, { seat_type: 'SD03' })).toBe(false)
  })

  it('matches multiple keys (AND semantics)', () => {
    expect(matchVariantCondition(
      { seat_type: ['SD04'], fabric_group: ['premium', 'standard'] },
      { seat_type: 'SD04', fabric_group: 'premium' },
    )).toBe(true)
  })

  it('rejects when one key does not match (AND)', () => {
    expect(matchVariantCondition(
      { seat_type: ['SD04'], fabric_group: ['premium'] },
      { seat_type: 'SD04', fabric_group: 'economy' },
    )).toBe(false)
  })

  it('handles negation — allows non-negated value', () => {
    expect(matchVariantCondition(
      { seat_type: { not: ['SD04'] } },
      { seat_type: 'SD01' },
    )).toBe(true)
  })

  it('handles negation — rejects negated value', () => {
    expect(matchVariantCondition(
      { seat_type: { not: ['SD04'] } },
      { seat_type: 'SD04' },
    )).toBe(false)
  })

  it('returns false when input key is missing', () => {
    expect(matchVariantCondition(
      { seat_type: ['SD01'] },
      {},
    )).toBe(false)
  })

  it('returns false when input value is the empty string (treated as missing)', () => {
    expect(matchVariantCondition(
      { seat_type: ['SD01'] },
      { seat_type: '' },
    )).toBe(false)
  })

  it('returns true for empty condition (no keys)', () => {
    expect(matchVariantCondition({}, { seat_type: 'SD01' })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: explodeBom
// ---------------------------------------------------------------------------

describe('explodeBom', () => {
  it('explodes a simple flat BOM', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productId: 'mat-1', netQuantity: '2.5', uomId: 'uom-szt' }),
      makeLine({ id: 'line-2', bomHeaderId: 'bom-1', productId: 'mat-2', netQuantity: '1', uomId: 'uom-m', sortOrder: 1 }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-1'), loader, emptyContext())

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].productId).toBe('mat-1')
    expect(result.lines[0].quantity).toBe(2.5)
    expect(result.lines[1].productId).toBe('mat-2')
    expect(result.depth).toBe(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('emits lines with null productId and attaches a keyed warning (soft-error contract)', async () => {
    // Unresolved lines are emitted with productId: null so the UI can
    // surface them; the reason is attached as a structured warning keyed
    // by bomLineId. Downstream planning consumers (MRP, WO, purchasing)
    // filter these out.
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productId: null, netQuantity: '1' }),
      makeLine({ id: 'line-2', bomHeaderId: 'bom-1', productId: 'mat-2', netQuantity: '3' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-1'), loader, emptyContext())

    expect(result.lines).toHaveLength(2)
    const nullLine = result.lines.find((l) => l.bomLineId === 'line-1')
    const resolvedLine = result.lines.find((l) => l.bomLineId === 'line-2')
    expect(nullLine?.productId).toBeNull()
    expect(resolvedLine?.productId).toBe('mat-2')
    expect(
      result.warnings.some(
        (w) => w.bomLineId === 'line-1' && w.message.includes('null product_id'),
      ),
    ).toBe(true)
  })

  it('handles empty BOM (no lines)', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const loader = createLoader(headers, [])
    const result = await explodeBom(defaultInput('bom-1'), loader, emptyContext())

    expect(result.lines).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('skips inactive BOM', async () => {
    const headers = [makeHeader({ id: 'bom-1', isActive: false })]
    const lines = [makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productId: 'mat-1', netQuantity: '1' })]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-1'), loader, emptyContext())

    expect(result.lines).toHaveLength(0)
    expect(result.warnings.some((w) => w.message.includes('inactive'))).toBe(true)
  })

  it('filters lines by date-effective range', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productId: 'mat-1', netQuantity: '1', validFrom: new Date('2026-01-01'), validTo: new Date('2026-05-31') }),
      makeLine({ id: 'line-2', bomHeaderId: 'bom-1', productId: 'mat-2', netQuantity: '1', validFrom: new Date('2026-06-01'), validTo: new Date('2026-12-31'), sortOrder: 1 }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-1', { effectiveDate: new Date('2026-06-15') }), loader, emptyContext())

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBe('mat-2')
  })

  it('filters lines by variant condition', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-common', bomHeaderId: 'bom-1', productId: 'mat-frame', netQuantity: '1' }),
      makeLine({ id: 'line-padded', bomHeaderId: 'bom-1', productId: 'mat-padding', netQuantity: '2', variantCondition: { seat_type: ['padded'] }, sortOrder: 1 }),
      makeLine({ id: 'line-flat', bomHeaderId: 'bom-1', productId: 'mat-flat', netQuantity: '1', variantCondition: { seat_type: ['flat'] }, sortOrder: 2 }),
    ]
    const loader = createLoader(headers, lines)

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { seat_type: 'padded' } }),
      loader,
      emptyContext(),
    )

    expect(result.lines).toHaveLength(2)
    expect(result.lines.map((l) => l.productId)).toEqual(['mat-frame', 'mat-padding'])
  })

  it('applies BomLineVariant quantity override', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productId: 'mat-fabric', netQuantity: '5', uomId: 'uom-m' }),
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
      defaultInput('bom-1', { variantConditions: { cushion: 'yes' } }),
      loader,
      emptyContext(),
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].quantity).toBe(8)
  })

  it('applies BomLineVariant product override', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productId: 'mat-standard', netQuantity: '1' }),
    ]
    const variants = [
      makeVariant({
        id: 'v-1', bomLineId: 'line-1',
        variantCondition: { grade: ['premium'] },
        productOverrideId: 'mat-premium',
      }),
    ]
    const loader = createLoader(headers, lines, variants)

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { grade: 'premium' } }),
      loader,
      emptyContext(),
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBe('mat-premium')
  })

  it('handles phantom BOM pass-through', async () => {
    const headers = [
      makeHeader({ id: 'bom-parent', productId: 'prod-sofa' }),
      makeHeader({ id: 'bom-phantom', productId: 'prod-frame', isPhantom: true }),
    ]
    const lines = [
      makeLine({ id: 'line-child', bomHeaderId: 'bom-parent', lineType: 'semi_product', childBomHeaderId: 'bom-phantom' }),
      makeLine({ id: 'line-wood', bomHeaderId: 'bom-phantom', productId: 'mat-wood', netQuantity: '4' }),
      makeLine({ id: 'line-screws', bomHeaderId: 'bom-phantom', productId: 'mat-screws', netQuantity: '20', sortOrder: 1 }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-parent'), loader, emptyContext())

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].productId).toBe('mat-wood')
    expect(result.lines[0].isPhantomPassThrough).toBe(true)
    expect(result.lines[1].productId).toBe('mat-screws')
    expect(result.lines[1].isPhantomPassThrough).toBe(true)
  })

  it('handles non-phantom child BOM (sub-assembly)', async () => {
    const headers = [
      makeHeader({ id: 'bom-parent', productId: 'prod-sofa' }),
      makeHeader({ id: 'bom-child', productId: 'prod-seat' }),
    ]
    const lines = [
      makeLine({ id: 'line-seat', bomHeaderId: 'bom-parent', lineType: 'semi_product', childBomHeaderId: 'bom-child', productId: 'prod-seat', netQuantity: '1' }),
      makeLine({ id: 'line-foam', bomHeaderId: 'bom-child', productId: 'mat-foam', netQuantity: '2' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-parent'), loader, emptyContext())

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].level).toBe(0)
    expect(result.lines[0].productId).toBe('prod-seat')
    expect(result.lines[1].level).toBe(1)
    expect(result.lines[1].productId).toBe('mat-foam')
    expect(result.depth).toBe(1)
  })

  it('handles multi-level BOM (3 levels)', async () => {
    const headers = [
      makeHeader({ id: 'bom-L0' }),
      makeHeader({ id: 'bom-L1' }),
      makeHeader({ id: 'bom-L2' }),
    ]
    const lines = [
      makeLine({ id: 'l0-sub', bomHeaderId: 'bom-L0', lineType: 'semi_product', childBomHeaderId: 'bom-L1', productId: 'sub-1', netQuantity: '1' }),
      makeLine({ id: 'l1-sub', bomHeaderId: 'bom-L1', lineType: 'semi_product', childBomHeaderId: 'bom-L2', productId: 'sub-2', netQuantity: '1' }),
      makeLine({ id: 'l2-mat', bomHeaderId: 'bom-L2', productId: 'mat-raw', netQuantity: '10' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-L0'), loader, emptyContext())

    expect(result.lines).toHaveLength(3)
    expect(result.depth).toBe(2)
  })

  it('detects circular reference and warns', async () => {
    const headers = [
      makeHeader({ id: 'bom-A' }),
      makeHeader({ id: 'bom-B' }),
    ]
    const lines = [
      makeLine({ id: 'line-A', bomHeaderId: 'bom-A', lineType: 'semi_product', childBomHeaderId: 'bom-B', productId: 'x', netQuantity: '1' }),
      makeLine({ id: 'line-B', bomHeaderId: 'bom-B', lineType: 'semi_product', childBomHeaderId: 'bom-A', productId: 'y', netQuantity: '1' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-A'), loader, emptyContext())

    expect(result.warnings.some((w) => w.message.includes('Circular reference') || w.message.includes('already visited'))).toBe(true)
  })

  it('respects max depth limit', async () => {
    const headers = Array.from({ length: 5 }, (_, i) => makeHeader({ id: `bom-${i}` }))
    const lines = Array.from({ length: 4 }, (_, i) =>
      makeLine({
        id: `line-${i}`, bomHeaderId: `bom-${i}`,
        lineType: 'semi_product', childBomHeaderId: `bom-${i + 1}`,
        productId: `sub-${i}`, netQuantity: '1',
      }),
    )
    lines.push(makeLine({ id: 'line-leaf', bomHeaderId: 'bom-4', productId: 'mat-leaf', netQuantity: '1' }))

    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-0', { maxDepth: 2 }), loader, emptyContext())

    expect(result.warnings.some((w) => w.message.includes('Max depth'))).toBe(true)
  })

  it('computes gross quantity with scrap percentage', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productId: 'mat-1', netQuantity: '10', scrapPercentage: '10' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-1'), loader, emptyContext())

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].quantity).toBe(10)
    expect(result.lines[0].scrapPercentage).toBe(10)
    expect(result.lines[0].grossQuantity).toBeCloseTo(11.111, 2)
  })

  it('warns when BOM header not found', async () => {
    const loader = createLoader([], [])
    const result = await explodeBom(defaultInput('nonexistent'), loader, emptyContext())

    expect(result.lines).toHaveLength(0)
    expect(result.warnings.some((w) => w.message.includes('not found'))).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Combined mechanism tests
  // ---------------------------------------------------------------------------

  it('combines phantom pass-through + variant conditions + date-effective', async () => {
    // Scenario: Sofa with a phantom frame sub-assembly.
    // Frame BOM has two date-effective lines (old screws replaced by new screws mid-year)
    // and a variant-conditional reinforcement bar only for "heavy duty" config.
    const headers = [
      makeHeader({ id: 'bom-sofa', productId: 'prod-sofa' }),
      makeHeader({ id: 'bom-frame', productId: 'prod-frame', isPhantom: true }),
    ]
    const lines = [
      // Sofa top level: fabric (always) + frame sub-assembly
      makeLine({ id: 'sofa-fabric', bomHeaderId: 'bom-sofa', productId: 'mat-fabric', netQuantity: '6', sortOrder: 0 }),
      makeLine({ id: 'sofa-frame', bomHeaderId: 'bom-sofa', lineType: 'semi_product', childBomHeaderId: 'bom-frame', sortOrder: 1 }),
      // Frame (phantom): wood always, old screws until May, new screws from June, reinforcement for heavy_duty only
      makeLine({ id: 'frame-wood', bomHeaderId: 'bom-frame', productId: 'mat-wood', netQuantity: '4', sortOrder: 0 }),
      makeLine({ id: 'frame-screws-old', bomHeaderId: 'bom-frame', productId: 'mat-screws-v1', netQuantity: '20', validFrom: new Date('2026-01-01'), validTo: new Date('2026-05-31'), sortOrder: 1 }),
      makeLine({ id: 'frame-screws-new', bomHeaderId: 'bom-frame', productId: 'mat-screws-v2', netQuantity: '16', validFrom: new Date('2026-06-01'), validTo: new Date('2026-12-31'), sortOrder: 2 }),
      makeLine({ id: 'frame-reinforce', bomHeaderId: 'bom-frame', productId: 'mat-steel-bar', netQuantity: '2', variantCondition: { duty: ['heavy'] }, sortOrder: 3 }),
    ]
    const loader = createLoader(headers, lines)

    // Test 1: June date, standard config → fabric + wood + new screws (no reinforcement)
    const r1 = await explodeBom(
      defaultInput('bom-sofa', { effectiveDate: new Date('2026-06-15'), variantConditions: { duty: 'standard' } }),
      loader,
      emptyContext(),
    )
    expect(r1.lines.map((l) => l.productId)).toEqual(['mat-fabric', 'mat-wood', 'mat-screws-v2'])
    expect(r1.lines[1].isPhantomPassThrough).toBe(true)
    expect(r1.lines[2].isPhantomPassThrough).toBe(true)

    // Test 2: March date, heavy duty config → fabric + wood + old screws + reinforcement
    const r2 = await explodeBom(
      defaultInput('bom-sofa', { effectiveDate: new Date('2026-03-15'), variantConditions: { duty: 'heavy' } }),
      loader,
      emptyContext(),
    )
    expect(r2.lines.map((l) => l.productId)).toEqual(['mat-fabric', 'mat-wood', 'mat-screws-v1', 'mat-steel-bar'])

    // Test 3: June date, heavy duty → fabric + wood + new screws + reinforcement
    const r3 = await explodeBom(
      defaultInput('bom-sofa', { effectiveDate: new Date('2026-06-15'), variantConditions: { duty: 'heavy' } }),
      loader,
      emptyContext(),
    )
    expect(r3.lines.map((l) => l.productId)).toEqual(['mat-fabric', 'mat-wood', 'mat-screws-v2', 'mat-steel-bar'])
  })

  it('combines variant condition filtering + BomLineVariant override', async () => {
    // Scenario: A seat BOM where the foam line is conditional on seat type,
    // and a BomLineVariant overrides quantity for the "XL" variant.
    const headers = [makeHeader({ id: 'bom-seat' })]
    const lines = [
      makeLine({ id: 'seat-base', bomHeaderId: 'bom-seat', productId: 'mat-plywood', netQuantity: '1', sortOrder: 0 }),
      makeLine({ id: 'seat-foam', bomHeaderId: 'bom-seat', productId: 'mat-foam', netQuantity: '2', variantCondition: { seat_type: ['padded', 'xl_padded'] }, sortOrder: 1 }),
    ]
    const variants = [
      makeVariant({
        id: 'v-xl', bomLineId: 'seat-foam',
        variantCondition: { seat_type: ['xl_padded'] },
        quantityOverride: '4',
      }),
    ]
    const loader = createLoader(headers, lines, variants)

    // Standard padded: base + foam at 2
    const r1 = await explodeBom(
      defaultInput('bom-seat', { variantConditions: { seat_type: 'padded' } }),
      loader,
      emptyContext(),
    )
    expect(r1.lines).toHaveLength(2)
    expect(r1.lines[1].quantity).toBe(2)

    // XL padded: base + foam at 4 (overridden)
    const r2 = await explodeBom(
      defaultInput('bom-seat', { variantConditions: { seat_type: 'xl_padded' } }),
      loader,
      emptyContext(),
    )
    expect(r2.lines).toHaveLength(2)
    expect(r2.lines[1].quantity).toBe(4)

    // Flat (no padding): base only
    const r3 = await explodeBom(
      defaultInput('bom-seat', { variantConditions: { seat_type: 'flat' } }),
      loader,
      emptyContext(),
    )
    expect(r3.lines).toHaveLength(1)
    expect(r3.lines[0].productId).toBe('mat-plywood')
  })

  it('applies BomLineVariant override by variant_id (variant_based mode)', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productId: 'mat-A', netQuantity: '10', uomId: 'uom-m' }),
    ]
    const variants = [
      makeVariant({
        id: 'v-red', bomLineId: 'line-1',
        variantId: 'variant-red',
        quantityOverride: '15',
        unitOverrideId: 'uom-mb',
      }),
      makeVariant({
        id: 'v-blue', bomLineId: 'line-1',
        variantId: 'variant-blue',
        productOverrideId: 'mat-B',
      }),
    ]
    const loader = createLoader(headers, lines, variants)

    // No variantId → no match → base values. Exercises the default
    // ExplosionInput.variantId shape (optional; null ≡ undefined).
    const base = await explodeBom(defaultInput('bom-1'), loader, emptyContext())
    expect(base.lines).toHaveLength(1)
    expect(base.lines[0].quantity).toBe(10)
    expect(base.lines[0].uomId).toBe('uom-m')
    expect(base.lines[0].productId).toBe('mat-A')

    // Pass variantId='variant-red' → first override matches → quantity/uom
    // swap. Product is untouched (productOverrideId is null on this row).
    const red = await explodeBom(
      defaultInput('bom-1', { variantId: 'variant-red' }),
      loader,
      emptyContext(),
    )
    expect(red.lines).toHaveLength(1)
    expect(red.lines[0].quantity).toBe(15)
    expect(red.lines[0].uomId).toBe('uom-mb')
    expect(red.lines[0].productId).toBe('mat-A')

    // Pass variantId='variant-blue' → second override matches → product swap.
    const blue = await explodeBom(
      defaultInput('bom-1', { variantId: 'variant-blue' }),
      loader,
      emptyContext(),
    )
    expect(blue.lines).toHaveLength(1)
    expect(blue.lines[0].productId).toBe('mat-B')
  })

  it('handles separate child BOMs per variant (variant-conditional semi_product lines)', async () => {
    // Scenario: Product has two backrest variants with completely different BOMs.
    // Semi-product lines with variant_condition select which child BOM to use.
    const headers = [
      makeHeader({ id: 'bom-chair' }),
      makeHeader({ id: 'bom-back-small', productId: 'prod-back-s' }),
      makeHeader({ id: 'bom-back-large', productId: 'prod-back-l' }),
    ]
    const lines = [
      makeLine({ id: 'chair-seat', bomHeaderId: 'bom-chair', productId: 'mat-seat', netQuantity: '1', sortOrder: 0 }),
      makeLine({ id: 'chair-back-s', bomHeaderId: 'bom-chair', lineType: 'semi_product', childBomHeaderId: 'bom-back-small', productId: 'prod-back-s', netQuantity: '1', variantCondition: { back_size: ['small'] }, sortOrder: 1 }),
      makeLine({ id: 'chair-back-l', bomHeaderId: 'bom-chair', lineType: 'semi_product', childBomHeaderId: 'bom-back-large', productId: 'prod-back-l', netQuantity: '1', variantCondition: { back_size: ['large'] }, sortOrder: 2 }),
      // Small backrest BOM
      makeLine({ id: 'back-s-wood', bomHeaderId: 'bom-back-small', productId: 'mat-wood-thin', netQuantity: '2' }),
      // Large backrest BOM
      makeLine({ id: 'back-l-wood', bomHeaderId: 'bom-back-large', productId: 'mat-wood-thick', netQuantity: '3' }),
      makeLine({ id: 'back-l-foam', bomHeaderId: 'bom-back-large', productId: 'mat-foam', netQuantity: '1', sortOrder: 1 }),
    ]
    const loader = createLoader(headers, lines)

    // Small backrest: seat + small back sub-assy + its child materials
    const rSmall = await explodeBom(
      defaultInput('bom-chair', { variantConditions: { back_size: 'small' } }),
      loader,
      emptyContext(),
    )
    expect(rSmall.lines.map((l) => l.productId)).toEqual(['mat-seat', 'prod-back-s', 'mat-wood-thin'])

    // Large backrest: seat + large back sub-assy + its child materials
    const rLarge = await explodeBom(
      defaultInput('bom-chair', { variantConditions: { back_size: 'large' } }),
      loader,
      emptyContext(),
    )
    expect(rLarge.lines.map((l) => l.productId)).toEqual(['mat-seat', 'prod-back-l', 'mat-wood-thick', 'mat-foam'])
  })
})

// ---------------------------------------------------------------------------
// Tests: Step 2 — Type-directed dynamic product resolution
// ---------------------------------------------------------------------------

describe('explodeBom — Step 2 (type-directed dynamic product resolution)', () => {
  it("resolves a 'product' attribute → sets productId, leaves productVariantId null", async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({
        id: 'line-1', bomHeaderId: 'bom-1',
        productResolveKey: 'legs', netQuantity: '4', uomId: 'uom-szt',
      }),
    ]
    const loader = createLoader(headers, lines)
    const context = makeContext({
      configAttributes: [{ key: 'legs', attributeType: 'product' }],
      catalogProducts: [{ id: 'prod-leg-A' }],
    })

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { legs: 'prod-leg-A' } }),
      loader,
      context,
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBe('prod-leg-A')
    expect(result.lines[0].productVariantId).toBeNull()
    expect(result.warnings).toHaveLength(0)
  })

  it("resolves a 'product_variant' attribute → sets productId from variant.productId AND productVariantId", async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({
        id: 'line-1', bomHeaderId: 'bom-1',
        productResolveKey: 'fabric', netQuantity: '6', uomId: 'uom-m',
      }),
    ]
    const loader = createLoader(headers, lines)
    const context = makeContext({
      configAttributes: [{ key: 'fabric', attributeType: 'product_variant' }],
      catalogProductVariants: [{ id: 'variant-soro-61', productId: 'prod-soro-collection' }],
    })

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { fabric: 'variant-soro-61' } }),
      loader,
      context,
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBe('prod-soro-collection')
    expect(result.lines[0].productVariantId).toBe('variant-soro-61')
    expect(result.warnings).toHaveLength(0)
  })

  it('warns and skips when resolve key is missing from the configAttributesByKey map', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productResolveKey: 'unknown_key', netQuantity: '1' }),
    ]
    const loader = createLoader(headers, lines)

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { unknown_key: 'some-uuid' } }),
      loader,
      emptyContext(),
    )

    // Emit-on-null: the line surfaces with productId null + a keyed warning.
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBeNull()
    expect(
      result.warnings.some(
        (w) => w.bomLineId === 'line-1' && w.message.includes("resolve key 'unknown_key' has no matching ConfigAttribute"),
      ),
    ).toBe(true)
    expect(
      result.warnings.some(
        (w) => w.bomLineId === 'line-1' && w.message.includes('null product_id'),
      ),
    ).toBe(true)
  })

  it('emits null-productId line when variantConditions omits the resolve key', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productResolveKey: 'fabric', netQuantity: '2' }),
    ]
    const loader = createLoader(headers, lines)
    const context = makeContext({
      configAttributes: [{ key: 'fabric', attributeType: 'product_variant' }],
    })

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: {} }),
      loader,
      context,
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBeNull()
    expect(
      result.warnings.some(
        (w) => w.bomLineId === 'line-1' && w.message.includes("resolve key 'fabric' missing from variantConditions"),
      ),
    ).toBe(true)
  })

  it('emits null-productId line when the attribute_type cannot drive dynamic resolution (enum)', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productResolveKey: 'seat_type', netQuantity: '1' }),
    ]
    const loader = createLoader(headers, lines)
    const context = makeContext({
      configAttributes: [{ key: 'seat_type', attributeType: 'enum' }],
    })

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { seat_type: 'SD01' } }),
      loader,
      context,
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBeNull()
    expect(
      result.warnings.some(
        (w) => w.bomLineId === 'line-1' && w.message.includes("attribute_type 'enum' for key 'seat_type' does not drive dynamic product resolution"),
      ),
    ).toBe(true)
  })

  it("emits null-productId line when 'product' UUID is not present in catalogProducts", async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productResolveKey: 'legs', netQuantity: '4' }),
    ]
    const loader = createLoader(headers, lines)
    const context = makeContext({
      configAttributes: [{ key: 'legs', attributeType: 'product' }],
      // catalogProducts intentionally empty: simulates a stale/deleted row
    })

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { legs: 'orphan-uuid' } }),
      loader,
      context,
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBeNull()
    expect(
      result.warnings.some(
        (w) => w.bomLineId === 'line-1' && w.message.includes("product 'orphan-uuid' for key 'legs' not found in catalog"),
      ),
    ).toBe(true)
  })

  it("emits null-productId line when 'product_variant' UUID is not present in catalogProductVariants", async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productResolveKey: 'fabric', netQuantity: '1' }),
    ]
    const loader = createLoader(headers, lines)
    const context = makeContext({
      configAttributes: [{ key: 'fabric', attributeType: 'product_variant' }],
    })

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { fabric: 'orphan-variant-uuid' } }),
      loader,
      context,
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBeNull()
    expect(
      result.warnings.some(
        (w) => w.bomLineId === 'line-1' && w.message.includes("product variant 'orphan-variant-uuid' for key 'fabric' not found in catalog"),
      ),
    ).toBe(true)
  })

  it('Step 3 override discards a Step 2 failure warning when it fills in productId', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      // Dynamic line that would fail Step 2 (no attribute defined), but…
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productResolveKey: 'fabric', netQuantity: '1' }),
    ]
    const variants = [
      // …has an override that fires and supplies a product.
      makeVariant({
        id: 'v-1', bomLineId: 'line-1',
        variantCondition: { trim: ['heavy'] },
        productOverrideId: 'mat-heavy-duty',
      }),
    ]
    const loader = createLoader(headers, lines, variants)

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { trim: 'heavy' } }),
      loader,
      emptyContext(),
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBe('mat-heavy-duty')
    // Step 2 warning was discarded because Step 3 saved the line; no stale
    // "resolve key has no matching ConfigAttribute" warning should appear.
    expect(result.warnings.some((w) => w.message.includes('has no matching ConfigAttribute'))).toBe(false)
    expect(result.warnings).toHaveLength(0)
  })

  it('Step 3 override pair also populates productVariantId on the output', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productId: 'mat-standard', netQuantity: '1' }),
    ]
    const variants = [
      makeVariant({
        id: 'v-1', bomLineId: 'line-1',
        variantCondition: { grade: ['premium'] },
        productOverrideId: 'mat-premium',
        productVariantOverrideId: 'variant-premium-black',
      }),
    ]
    const loader = createLoader(headers, lines, variants)

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { grade: 'premium' } }),
      loader,
      emptyContext(),
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBe('mat-premium')
    expect(result.lines[0].productVariantId).toBe('variant-premium-black')
  })

  it('carries static productVariantId through when no resolve key and no override matches', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({
        id: 'line-1', bomHeaderId: 'bom-1',
        productId: 'prod-soro', productVariantId: 'variant-soro-61',
        netQuantity: '3',
      }),
    ]
    const loader = createLoader(headers, lines)

    const result = await explodeBom(defaultInput('bom-1'), loader, emptyContext())

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBe('prod-soro')
    expect(result.lines[0].productVariantId).toBe('variant-soro-61')
  })

  it('warns when a malformed override pair (variant-only) hits a matched row', async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-1', bomHeaderId: 'bom-1', productId: 'mat-a', netQuantity: '1' }),
    ]
    const variants = [
      makeVariant({
        id: 'v-1', bomLineId: 'line-1',
        variantCondition: { color: ['red'] },
        productOverrideId: null,
        productVariantOverrideId: 'variant-without-product',
      }),
    ]
    const loader = createLoader(headers, lines, variants)

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { color: 'red' } }),
      loader,
      emptyContext(),
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBe('mat-a') // starting line carried through
    expect(result.warnings.some((w) => w.message.includes('product_variant_override_id without product_override_id'))).toBe(true)
  })

  it('defense-in-depth: rejects a line carrying both product_id and product_resolve_key', async () => {
    // Zod prevents this at save time (spec b §BomLine Constraints). If a
    // migration or direct-SQL write bypasses Zod, Step 2 must surface the
    // inconsistency rather than silently overwriting the static product.
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({
        id: 'line-bypass', bomHeaderId: 'bom-1',
        productId: 'mat-static', productResolveKey: 'fabric', netQuantity: '1',
      }),
    ]
    const loader = createLoader(headers, lines)
    const context = makeContext({
      configAttributes: [{ key: 'fabric', attributeType: 'product' }],
      catalogProducts: [{ id: 'prod-dynamic' }],
    })

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: { fabric: 'prod-dynamic' } }),
      loader,
      context,
    )

    // Even though variantConditions would resolve, the line is flagged as
    // unresolved and emitted with productId: null.
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].productId).toBeNull()
    expect(
      result.warnings.some(
        (w) =>
          w.bomLineId === 'line-bypass' &&
          w.message.includes('carries both product_id and product_resolve_key') &&
          w.message.includes('Zod invariant bypassed'),
      ),
    ).toBe(true)
  })

  it('defense-in-depth: rejects product_resolve_key on a semi_product line', async () => {
    // Zod forbids resolve-key on semi_product (lineType scope rule).
    // Bypass path should produce a dedicated warning and skip Step 2 entirely.
    const headers = [
      makeHeader({ id: 'bom-parent' }),
      makeHeader({ id: 'bom-child' }),
    ]
    const lines = [
      makeLine({
        id: 'line-bypass', bomHeaderId: 'bom-parent',
        lineType: 'semi_product', childBomHeaderId: 'bom-child',
        productResolveKey: 'fabric', netQuantity: '1',
      }),
      makeLine({
        id: 'line-child', bomHeaderId: 'bom-child',
        productId: 'mat-foo', netQuantity: '2',
      }),
    ]
    const loader = createLoader(headers, lines)
    const context = makeContext({
      configAttributes: [{ key: 'fabric', attributeType: 'product' }],
      catalogProducts: [{ id: 'prod-fabric' }],
    })

    const result = await explodeBom(
      defaultInput('bom-parent', { variantConditions: { fabric: 'prod-fabric' } }),
      loader,
      context,
    )

    // The dedicated warning must be present and keyed to the bypass line.
    expect(
      result.warnings.some(
        (w) =>
          w.bomLineId === 'line-bypass' &&
          w.message.includes("product_resolve_key on 'semi_product' line violates spec"),
      ),
    ).toBe(true)
    // The semi-product line itself IS emitted (with productId: null) —
    // Step 4's semi-product branch does not apply the material-line
    // skip-on-null rule. The dedicated warning is what signals the bypass.
    const bypassLine = result.lines.find((l) => l.bomLineId === 'line-bypass')
    expect(bypassLine).toBeDefined()
    expect(bypassLine?.productId).toBeNull()
    expect(bypassLine?.productVariantId).toBeNull()
    // Child BOM's own material line still emits normally.
    expect(result.lines.some((l) => l.productId === 'mat-foo')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: Warning shape + consumer helpers
// ---------------------------------------------------------------------------

describe('explodeBom — structured warnings', () => {
  it('emits graph-level warnings with bomLineId: null', async () => {
    // Max depth is a graph-level condition, not tied to any specific line.
    const headers = [
      makeHeader({ id: 'bom-0' }),
      makeHeader({ id: 'bom-1' }),
      makeHeader({ id: 'bom-2' }),
    ]
    const lines = [
      makeLine({ id: 'l0', bomHeaderId: 'bom-0', lineType: 'semi_product', childBomHeaderId: 'bom-1', netQuantity: '1' }),
      makeLine({ id: 'l1', bomHeaderId: 'bom-1', lineType: 'semi_product', childBomHeaderId: 'bom-2', netQuantity: '1' }),
      makeLine({ id: 'l2', bomHeaderId: 'bom-2', productId: 'mat', netQuantity: '1' }),
    ]
    const loader = createLoader(headers, lines)
    const result = await explodeBom(defaultInput('bom-0', { maxDepth: 1 }), loader, emptyContext())

    const depthWarning = result.warnings.find((w) => w.message.includes('Max depth'))
    expect(depthWarning).toBeDefined()
    expect(depthWarning?.bomLineId).toBeNull()
  })

  it("warningsByLineId() groups line-specific warnings and drops graph-level ones", async () => {
    const headers = [makeHeader({ id: 'bom-1' })]
    const lines = [
      makeLine({ id: 'line-a', bomHeaderId: 'bom-1', productResolveKey: 'fabric', netQuantity: '1' }),
      makeLine({ id: 'line-b', bomHeaderId: 'bom-1', productId: 'mat-b', netQuantity: '1' }),
    ]
    const loader = createLoader(headers, lines)
    const context = makeContext({
      configAttributes: [{ key: 'fabric', attributeType: 'product_variant' }],
      // variantConditions missing 'fabric' — Step 2 warns for line-a only.
    })

    const result = await explodeBom(
      defaultInput('bom-1', { variantConditions: {} }),
      loader,
      context,
    )

    const grouped = warningsByLineId(result)
    // line-a has two line-specific warnings: the Step 2 missing-key + the
    // "emitted with null product_id" reason; both keyed to line-a.
    expect(grouped.get('line-a')?.length).toBeGreaterThanOrEqual(1)
    expect(grouped.get('line-a')?.some((m) => m.includes("resolve key 'fabric' missing"))).toBe(true)
    // line-b resolved cleanly and carries no warnings.
    expect(grouped.get('line-b')).toBeUndefined()
  })
})
