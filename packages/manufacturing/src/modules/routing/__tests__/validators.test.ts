import {
  workCenterCreateSchema,
  factoryZoneCreateSchema,
  routingTemplateCreateSchema,
  operationTemplateCreateSchema,
  operationTemplateVariantCreateSchema,
  operationDependencyCreateSchema,
} from '../data/validators'

const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const scope = { organizationId: uuid, tenantId: uuid }

describe('WorkCenter validators', () => {
  it('accepts valid create', () => {
    expect(workCenterCreateSchema.safeParse({ ...scope, name: 'CNC', code: 'WC-CNC' }).success).toBe(true)
  })

  it('rejects efficiency over 200', () => {
    expect(workCenterCreateSchema.safeParse({ ...scope, name: 'X', code: 'X', efficiencyPercent: 250 }).success).toBe(false)
  })

  it('rejects capacity below 1', () => {
    expect(workCenterCreateSchema.safeParse({ ...scope, name: 'X', code: 'X', capacity: 0 }).success).toBe(false)
  })
})

describe('FactoryZone validators', () => {
  it('accepts valid create', () => {
    expect(factoryZoneCreateSchema.safeParse({ ...scope, name: 'Hall A', code: 'ZONE-A' }).success).toBe(true)
  })
})

describe('RoutingTemplate validators', () => {
  it('accepts valid create', () => {
    expect(routingTemplateCreateSchema.safeParse({ ...scope, productId: uuid, name: 'Main routing' }).success).toBe(true)
  })
})

describe('OperationTemplate validators', () => {
  it('accepts valid create', () => {
    expect(operationTemplateCreateSchema.safeParse({ ...scope, routingTemplateId: uuid, name: 'Cut fabric' }).success).toBe(true)
  })

  it('accepts all time fields', () => {
    const result = operationTemplateCreateSchema.safeParse({
      ...scope, routingTemplateId: uuid, name: 'Sew',
      setupTimeMinutes: '10', runTimeMinutes: '45', teardownTimeMinutes: '5',
      queueTimeMinutes: '15', waitTimeMinutes: '30', moveTimeMinutes: '10',
      paymentType: 'piecework', pieceworkRate: '2.50',
    })
    expect(result.success).toBe(true)
  })
})

describe('OperationTemplateVariant validators', () => {
  it('accepts with variantCondition', () => {
    const result = operationTemplateVariantCreateSchema.safeParse({
      ...scope, operationTemplateId: uuid,
      variantCondition: { size: ['XL'] },
      runTimeOverride: '60',
    })
    expect(result.success).toBe(true)
  })

  it('rejects both variantId and variantCondition (XOR)', () => {
    const result = operationTemplateVariantCreateSchema.safeParse({
      ...scope, operationTemplateId: uuid,
      variantId: uuid,
      variantCondition: { size: ['XL'] },
    })
    expect(result.success).toBe(false)
  })

  it('rejects neither variantId nor variantCondition', () => {
    const result = operationTemplateVariantCreateSchema.safeParse({
      ...scope, operationTemplateId: uuid,
    })
    expect(result.success).toBe(false)
  })
})

describe('OperationDependency validators', () => {
  it('accepts valid create', () => {
    const pred = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
    const succ = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'
    expect(operationDependencyCreateSchema.safeParse({
      ...scope, predecessorOperationId: pred, successorOperationId: succ,
    }).success).toBe(true)
  })

  it('rejects self-reference', () => {
    expect(operationDependencyCreateSchema.safeParse({
      ...scope, predecessorOperationId: uuid, successorOperationId: uuid,
    }).success).toBe(false)
  })

  it('rejects both overlap types', () => {
    const pred = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
    const succ = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'
    expect(operationDependencyCreateSchema.safeParse({
      ...scope, predecessorOperationId: pred, successorOperationId: succ,
      overlapQuantity: 5, overlapTimeMinutes: '10',
    }).success).toBe(false)
  })
})
