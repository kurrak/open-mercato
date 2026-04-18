import {
  bomHeaderCreateSchema,
  bomHeaderUpdateSchema,
  bomLineCreateSchema,
  bomLineVariantCreateSchema,
  bomExplosionInputSchema,
  collectBomLineInvariantViolations,
  collectBomLineVariantInvariantViolations,
} from '../data/validators'

const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const uuid2 = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const scope = { organizationId: uuid, tenantId: uuid }

describe('BomHeader validators', () => {
  it('accepts valid create input', () => {
    const result = bomHeaderCreateSchema.safeParse({
      ...scope,
      productId: uuid,
      name: 'Main BOM',
    })
    expect(result.success).toBe(true)
  })

  it('accepts all optional fields', () => {
    const result = bomHeaderCreateSchema.safeParse({
      ...scope,
      productId: uuid,
      name: 'Secondary BOM',
      bomUsage: 'packaging',
      isPhantom: true,
      isActive: false,
      version: 2,
      notes: 'Test notes',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const result = bomHeaderCreateSchema.safeParse({ ...scope, productId: uuid })
    expect(result.success).toBe(false)
  })

  it('defaults bomUsage to production', () => {
    const result = bomHeaderCreateSchema.parse({ ...scope, productId: uuid, name: 'BOM' })
    expect(result.bomUsage).toBe('production')
  })
})

describe('BomLine validators', () => {
  it('accepts valid create input', () => {
    const result = bomLineCreateSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
    })
    expect(result.success).toBe(true)
  })

  it('accepts variant_condition with AND semantics', () => {
    const result = bomLineCreateSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      variantCondition: { seat_type: ['SD01', 'SD02'], fabric: ['premium'] },
    })
    expect(result.success).toBe(true)
  })

  it('accepts variant_condition with negation', () => {
    const result = bomLineCreateSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      variantCondition: { seat_type: { not: ['SD04'] } },
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-numeric netQuantity', () => {
    const result = bomLineCreateSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      netQuantity: 'abc',
    })
    expect(result.success).toBe(false)
  })

  it('rejects BomLine with both productId and productResolveKey (static XOR dynamic)', () => {
    const result = bomLineCreateSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      productId: uuid2,
      productResolveKey: 'fabric',
    })
    expect(result.success).toBe(false)
  })

  it('rejects BomLine with productResolveKey + productVariantId (dynamic cannot pin variant)', () => {
    const result = bomLineCreateSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      productResolveKey: 'fabric',
      productVariantId: uuid2,
    })
    expect(result.success).toBe(false)
  })

  it('rejects BomLine with productVariantId but no productId (variant requires product)', () => {
    const result = bomLineCreateSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      productVariantId: uuid2,
    })
    expect(result.success).toBe(false)
  })

  it('rejects BomLine with productResolveKey on semi_product line', () => {
    const result = bomLineCreateSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      lineType: 'semi_product',
      childBomHeaderId: uuid2,
      productResolveKey: 'fabric',
    })
    expect(result.success).toBe(false)
  })

  it('accepts BomLine with only productResolveKey (dynamic mode)', () => {
    const result = bomLineCreateSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      productResolveKey: 'fabric',
    })
    expect(result.success).toBe(true)
  })

  it('accepts BomLine with productId + productVariantId (static pinning)', () => {
    const result = bomLineCreateSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      productId: uuid,
      productVariantId: uuid2,
    })
    expect(result.success).toBe(true)
  })
})

describe('collectBomLineInvariantViolations (pure fn, used by update command)', () => {
  it('returns empty list for valid state', () => {
    expect(collectBomLineInvariantViolations({
      lineType: 'material',
      productId: uuid,
      productVariantId: uuid2,
      productResolveKey: null,
    })).toEqual([])
  })

  it('flags static-vs-dynamic XOR', () => {
    const violations = collectBomLineInvariantViolations({
      productId: uuid,
      productResolveKey: 'fabric',
    })
    expect(violations.some((v) => v.message.includes('cannot carry both'))).toBe(true)
  })

  it('flags resolve-key + variant pinning', () => {
    const violations = collectBomLineInvariantViolations({
      productResolveKey: 'fabric',
      productVariantId: uuid,
    })
    expect(violations.some((v) => v.message.includes('cannot also pin'))).toBe(true)
  })

  it('flags variant without product', () => {
    const violations = collectBomLineInvariantViolations({
      productVariantId: uuid,
    })
    expect(violations.some((v) => v.message.includes('variant requires parent product'))).toBe(true)
  })

  it('flags resolve-key on semi_product', () => {
    const violations = collectBomLineInvariantViolations({
      lineType: 'semi_product',
      productResolveKey: 'fabric',
    })
    expect(violations.some((v) => v.message.includes("line_type = 'material'"))).toBe(true)
  })

  it('stacks multiple violations', () => {
    // State deliberately triggers exactly 3 rules:
    //  - resolve+product (static XOR dynamic)
    //  - resolve+variant (dynamic cannot pin variant)
    //  - resolve+semi_product (resolve-key scope)
    // Anchored with toBe(3) so silently dropping a rule in the future fails
    // the test instead of degrading to 2.
    const violations = collectBomLineInvariantViolations({
      lineType: 'semi_product',
      productId: uuid,
      productVariantId: uuid2,
      productResolveKey: 'fabric',
    })
    expect(violations).toHaveLength(3)
  })
})

describe('BomLineVariant validators', () => {
  it('accepts create with variantId', () => {
    const result = bomLineVariantCreateSchema.safeParse({
      ...scope,
      bomLineId: uuid,
      variantId: uuid,
    })
    expect(result.success).toBe(true)
  })

  it('accepts create with variantCondition', () => {
    const result = bomLineVariantCreateSchema.safeParse({
      ...scope,
      bomLineId: uuid,
      variantCondition: { color: ['red'] },
    })
    expect(result.success).toBe(true)
  })

  it('rejects when both variantId and variantCondition are provided (XOR)', () => {
    const result = bomLineVariantCreateSchema.safeParse({
      ...scope,
      bomLineId: uuid,
      variantId: uuid,
      variantCondition: { color: ['red'] },
    })
    expect(result.success).toBe(false)
  })

  it('rejects when neither variantId nor variantCondition is provided (XOR)', () => {
    const result = bomLineVariantCreateSchema.safeParse({
      ...scope,
      bomLineId: uuid,
    })
    expect(result.success).toBe(false)
  })

  it('rejects productVariantOverrideId without productOverrideId', () => {
    const result = bomLineVariantCreateSchema.safeParse({
      ...scope,
      bomLineId: uuid,
      variantId: uuid2,
      productVariantOverrideId: uuid,
    })
    expect(result.success).toBe(false)
  })

  it('accepts productOverrideId + productVariantOverrideId paired', () => {
    const result = bomLineVariantCreateSchema.safeParse({
      ...scope,
      bomLineId: uuid,
      variantId: uuid2,
      productOverrideId: uuid,
      productVariantOverrideId: uuid2,
    })
    expect(result.success).toBe(true)
  })
})

describe('collectBomLineVariantInvariantViolations (pure fn)', () => {
  it('returns empty list for variantId-only activation', () => {
    expect(collectBomLineVariantInvariantViolations({
      variantId: uuid,
      variantCondition: null,
    })).toEqual([])
  })

  it('returns empty list for variantCondition-only activation', () => {
    expect(collectBomLineVariantInvariantViolations({
      variantId: null,
      variantCondition: { color: ['red'] },
    })).toEqual([])
  })

  it('flags activation XOR when both present', () => {
    const violations = collectBomLineVariantInvariantViolations({
      variantId: uuid,
      variantCondition: { color: ['red'] },
    })
    expect(violations.some((v) => v.message.includes('activation XOR'))).toBe(true)
  })

  it('flags activation XOR when neither present', () => {
    const violations = collectBomLineVariantInvariantViolations({
      variantId: null,
      variantCondition: null,
    })
    expect(violations.some((v) => v.message.includes('activation XOR'))).toBe(true)
  })

  it('flags productVariantOverrideId without productOverrideId', () => {
    const violations = collectBomLineVariantInvariantViolations({
      variantId: uuid,
      productVariantOverrideId: uuid,
    })
    expect(violations.some((v) => v.message.includes('requires product_override_id'))).toBe(true)
  })
})

describe('BomExplosionInput validator', () => {
  it('accepts minimal input', () => {
    const result = bomExplosionInputSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.maxDepth).toBe(10)
      expect(result.data.variantConditions).toEqual({})
    }
  })

  it('accepts full input', () => {
    const result = bomExplosionInputSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      variantConditions: { seat: 'SD01' },
      effectiveDate: '2026-06-01',
      maxDepth: 5,
    })
    expect(result.success).toBe(true)
  })

  it('rejects maxDepth over 50', () => {
    const result = bomExplosionInputSchema.safeParse({
      ...scope,
      bomHeaderId: uuid,
      maxDepth: 100,
    })
    expect(result.success).toBe(false)
  })
})
