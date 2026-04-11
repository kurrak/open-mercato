import { validateNamespace } from '../lib/namespace-validator'
import type { ConfigAttribute, AttributeType } from '../data/entities'

function makeAttribute(key: string): ConfigAttribute {
  return {
    id: `attr-${key}`,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    productId: 'prod-1',
    key,
    label: key,
    attributeType: 'enum' as AttributeType,
    allowedValues: null,
    materialFilterId: null,
    isMandatory: true,
    displayOrder: 0,
    defaultValue: null,
    attributeGroup: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as ConfigAttribute
}

describe('validateNamespace', () => {
  it('should return valid for known keys', () => {
    const attributes = [makeAttribute('seat_type'), makeAttribute('fabric')]
    const result = validateNamespace({ seat_type: ['SD04'], fabric: ['Soro'] }, attributes)

    expect(result.valid).toBe(true)
    expect(result.unknownKeys).toHaveLength(0)
  })

  it('should identify unknown keys', () => {
    const attributes = [makeAttribute('seat_type')]
    const result = validateNamespace({ seat_type: ['SD04'], unknown_key: ['foo'] }, attributes)

    expect(result.valid).toBe(false)
    expect(result.unknownKeys).toEqual(['unknown_key'])
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('unknown_key')]),
    )
  })

  it('should warn when no ConfigAttributes defined', () => {
    const result = validateNamespace({ any_key: ['value'] }, [])

    expect(result.valid).toBe(false)
    expect(result.unknownKeys).toEqual(['any_key'])
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('No ConfigAttributes defined')]),
    )
  })

  it('should return valid for empty variant_condition', () => {
    const attributes = [makeAttribute('seat_type')]
    const result = validateNamespace({}, attributes)

    expect(result.valid).toBe(true)
    expect(result.unknownKeys).toHaveLength(0)
  })

  it('should handle mixed known and unknown keys', () => {
    const attributes = [makeAttribute('seat_type'), makeAttribute('fabric')]
    const result = validateNamespace(
      { seat_type: ['SD04'], fabric: ['Soro'], bad_key: ['x'], another_bad: ['y'] },
      attributes,
    )

    expect(result.valid).toBe(false)
    expect(result.unknownKeys).toEqual(expect.arrayContaining(['bad_key', 'another_bad']))
    expect(result.unknownKeys).toHaveLength(2)
  })
})
