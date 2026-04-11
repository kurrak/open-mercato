import {
  configAttributeCreateSchema,
  configAttributeUpdateSchema,
  constraintRuleCreateSchema,
  constraintRuleUpdateSchema,
} from '../data/validators'

const validScope = {
  organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  tenantId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
}
const validProductId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
const validRecordId = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'

describe('configAttributeCreateSchema', () => {
  it('should accept valid input', () => {
    const result = configAttributeCreateSchema.safeParse({
      ...validScope,
      productId: validProductId,
      key: 'seat_type',
      label: 'Seat Type',
    })
    expect(result.success).toBe(true)
  })

  it('should reject invalid key format (not snake_case)', () => {
    const result = configAttributeCreateSchema.safeParse({
      ...validScope,
      productId: validProductId,
      key: 'SeatType',
      label: 'Seat Type',
    })
    expect(result.success).toBe(false)
  })

  it('should reject empty key', () => {
    const result = configAttributeCreateSchema.safeParse({
      ...validScope,
      productId: validProductId,
      key: '',
      label: 'Seat Type',
    })
    expect(result.success).toBe(false)
  })

  it('should accept all valid attribute types', () => {
    for (const attributeType of ['enum', 'numeric_range', 'boolean', 'text', 'material']) {
      const result = configAttributeCreateSchema.safeParse({
        ...validScope,
        productId: validProductId,
        key: 'test_key',
        label: 'Test',
        attributeType,
      })
      expect(result.success).toBe(true)
    }
  })

  it('should reject invalid attribute type', () => {
    const result = configAttributeCreateSchema.safeParse({
      ...validScope,
      productId: validProductId,
      key: 'test_key',
      label: 'Test',
      attributeType: 'invalid',
    })
    expect(result.success).toBe(false)
  })

  it('should default attributeType to enum', () => {
    const result = configAttributeCreateSchema.parse({
      ...validScope,
      productId: validProductId,
      key: 'test_key',
      label: 'Test',
    })
    expect(result.attributeType).toBe('enum')
  })
})

describe('configAttributeUpdateSchema', () => {
  it('should accept partial update with id', () => {
    const result = configAttributeUpdateSchema.safeParse({
      id: validRecordId,
      label: 'Updated Label',
    })
    expect(result.success).toBe(true)
  })

  it('should require id', () => {
    const result = configAttributeUpdateSchema.safeParse({ label: 'Updated Label' })
    expect(result.success).toBe(false)
  })
})

describe('constraintRuleCreateSchema', () => {
  it('should accept valid input', () => {
    const result = constraintRuleCreateSchema.safeParse({
      ...validScope,
      productId: validProductId,
      conditionJson: { seat_type: ['SD01N'] },
      actionType: 'exclude_combination',
      actionData: {},
    })
    expect(result.success).toBe(true)
  })

  it('should accept all valid action types', () => {
    for (const actionType of ['restrict_values', 'exclude_combination', 'require_value', 'set_default']) {
      const result = constraintRuleCreateSchema.safeParse({
        ...validScope,
        productId: validProductId,
        conditionJson: { key: ['value'] },
        actionType,
        actionData: {},
      })
      expect(result.success).toBe(true)
    }
  })

  it('should reject invalid action type', () => {
    const result = constraintRuleCreateSchema.safeParse({
      ...validScope,
      productId: validProductId,
      conditionJson: { key: ['value'] },
      actionType: 'invalid_action',
      actionData: {},
    })
    expect(result.success).toBe(false)
  })

  it('should accept negation in conditionJson', () => {
    const result = constraintRuleCreateSchema.safeParse({
      ...validScope,
      productId: validProductId,
      conditionJson: { frame: { not: ['SK23'] } },
      actionType: 'set_default',
      actionData: { leg: 'standard' },
    })
    expect(result.success).toBe(true)
  })
})

describe('constraintRuleUpdateSchema', () => {
  it('should accept partial update with id', () => {
    const result = constraintRuleUpdateSchema.safeParse({
      id: validRecordId,
      priority: 10,
    })
    expect(result.success).toBe(true)
  })

  it('should require id', () => {
    const result = constraintRuleUpdateSchema.safeParse({ priority: 10 })
    expect(result.success).toBe(false)
  })
})
