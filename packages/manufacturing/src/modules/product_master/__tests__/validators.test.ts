import {
  unitOfMeasureCreateSchema,
  unitOfMeasureUpdateSchema,
  productionMethodCreateSchema,
  productionMethodUpdateSchema,
  supplierInfoCreateSchema,
  supplierInfoUpdateSchema,
  uomConversionCreateSchema,
  uomConversionUpdateSchema,
} from '../data/validators'

const validUuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const validScope = { organizationId: validUuid, tenantId: validUuid }

describe('UnitOfMeasure validators', () => {
  it('accepts valid create input', () => {
    const result = unitOfMeasureCreateSchema.safeParse({
      ...validScope,
      code: 'kg',
      name: 'Kilogram',
      uomType: 'weight',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing code', () => {
    const result = unitOfMeasureCreateSchema.safeParse({
      ...validScope,
      name: 'Kilogram',
      uomType: 'weight',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid uomType', () => {
    const result = unitOfMeasureCreateSchema.safeParse({
      ...validScope,
      code: 'kg',
      name: 'Kilogram',
      uomType: 'invalid',
    })
    expect(result.success).toBe(false)
  })

  it('rejects code longer than 20 chars', () => {
    const result = unitOfMeasureCreateSchema.safeParse({
      ...validScope,
      code: 'a'.repeat(21),
      name: 'Test',
      uomType: 'piece',
    })
    expect(result.success).toBe(false)
  })

  it('accepts partial update', () => {
    const result = unitOfMeasureUpdateSchema.safeParse({
      id: validUuid,
      name: 'Updated Name',
    })
    expect(result.success).toBe(true)
  })
})

describe('ProductionMethod validators', () => {
  it('accepts valid create input', () => {
    const result = productionMethodCreateSchema.safeParse({
      ...validScope,
      productId: validUuid,
      name: 'Internal sewing',
    })
    expect(result.success).toBe(true)
  })

  it('accepts all optional fields', () => {
    const result = productionMethodCreateSchema.safeParse({
      ...validScope,
      productId: validUuid,
      name: 'Outsource',
      bomHeaderId: validUuid,
      routingTemplateId: null,
      isDefault: true,
      lifecycleState: 'active',
      version: 2,
      validFrom: '2026-01-01',
      validTo: null,
      variantCondition: { color: 'red' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing productId', () => {
    const result = productionMethodCreateSchema.safeParse({
      ...validScope,
      name: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid lifecycleState', () => {
    const result = productionMethodCreateSchema.safeParse({
      ...validScope,
      productId: validUuid,
      name: 'Test',
      lifecycleState: 'invalid',
    })
    expect(result.success).toBe(false)
  })

  it('accepts partial update', () => {
    const result = productionMethodUpdateSchema.safeParse({
      id: validUuid,
      name: 'Updated',
      lifecycleState: 'superseded',
    })
    expect(result.success).toBe(true)
  })
})

describe('SupplierInfo validators', () => {
  it('accepts valid create with minimal fields', () => {
    const result = supplierInfoCreateSchema.safeParse({
      ...validScope,
      productId: validUuid,
      supplierName: 'Vendor A',
    })
    expect(result.success).toBe(true)
  })

  it('accepts all optional fields', () => {
    const result = supplierInfoCreateSchema.safeParse({
      ...validScope,
      productId: validUuid,
      supplierName: 'Vendor B',
      supplierId: validUuid,
      supplierSku: 'SKU-001',
      price: '10.50',
      currency: 'PLN',
      minQty: '100',
      orderMultiple: '10',
      leadTimeDays: 14,
      isPreferred: true,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      variantId: validUuid,
      notes: 'Preferred supplier for leather',
    })
    expect(result.success).toBe(true)
  })

  it('rejects currency not exactly 3 chars', () => {
    const result = supplierInfoCreateSchema.safeParse({
      ...validScope,
      productId: validUuid,
      supplierName: 'Vendor',
      currency: 'EURO',
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative lead time', () => {
    const result = supplierInfoCreateSchema.safeParse({
      ...validScope,
      productId: validUuid,
      supplierName: 'Vendor',
      leadTimeDays: -1,
    })
    expect(result.success).toBe(false)
  })

  it('accepts partial update', () => {
    const result = supplierInfoUpdateSchema.safeParse({
      id: validUuid,
      price: '15.00',
      currency: 'EUR',
    })
    expect(result.success).toBe(true)
  })
})

describe('UomConversion validators', () => {
  it('accepts valid create input', () => {
    const result = uomConversionCreateSchema.safeParse({
      ...validScope,
      productId: validUuid,
      fromUomId: validUuid,
      toUomId: validUuid,
      factor: '2.5',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing factor', () => {
    const result = uomConversionCreateSchema.safeParse({
      ...validScope,
      productId: validUuid,
      fromUomId: validUuid,
      toUomId: validUuid,
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty factor', () => {
    const result = uomConversionCreateSchema.safeParse({
      ...validScope,
      productId: validUuid,
      fromUomId: validUuid,
      toUomId: validUuid,
      factor: '',
    })
    expect(result.success).toBe(false)
  })

  it('accepts partial update', () => {
    const result = uomConversionUpdateSchema.safeParse({
      id: validUuid,
      factor: '3.14159265',
    })
    expect(result.success).toBe(true)
  })
})
