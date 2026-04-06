import {
  bomHeaderCreateSchema,
  bomHeaderUpdateSchema,
  bomLineCreateSchema,
  bomLineVariantCreateSchema,
  bomExplosionInputSchema,
} from '../data/validators'

const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
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
      variantConditions: { seat: ['SD01'] },
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
