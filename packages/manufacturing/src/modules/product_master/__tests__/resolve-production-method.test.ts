import { resolveProductionMethod } from '../lib/resolve-production-method'
import type { ProductionMethod } from '../data/entities'

function makePM(overrides: Partial<ProductionMethod> & { id: string; name: string }): ProductionMethod {
  return {
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    productId: 'prod-1',
    bomHeaderId: null,
    routingTemplateId: null,
    isDefault: false,
    variantCondition: null,
    version: 1,
    validFrom: undefined,
    validTo: undefined,
    lifecycleState: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: undefined,
    ...overrides,
  } as ProductionMethod
}

describe('resolveProductionMethod', () => {
  it('returns none when no production methods exist', () => {
    const result = resolveProductionMethod([])
    expect(result.productionMethod).toBeNull()
    expect(result.fallback).toBe('none')
    expect(result.warnings).toContain('No active production methods found')
  })

  it('returns none when all PMs are non-active lifecycle state', () => {
    const pms = [makePM({ id: '1', name: 'Draft PM', lifecycleState: 'draft' })]
    const result = resolveProductionMethod(pms)
    expect(result.productionMethod).toBeNull()
    expect(result.fallback).toBe('none')
  })

  it('returns none when all PMs are soft-deleted', () => {
    const pms = [makePM({ id: '1', name: 'Deleted PM', deletedAt: new Date() })]
    const result = resolveProductionMethod(pms)
    expect(result.productionMethod).toBeNull()
    expect(result.fallback).toBe('none')
  })

  it('returns default PM when no variant conditions provided', () => {
    const pms = [
      makePM({ id: '1', name: 'Non-default', isDefault: false }),
      makePM({ id: '2', name: 'Default PM', isDefault: true }),
    ]
    const result = resolveProductionMethod(pms)
    expect(result.productionMethod?.id).toBe('2')
    expect(result.fallback).toBe('default')
    expect(result.warnings).toHaveLength(0)
  })

  it('returns variant match when conditions match', () => {
    const pms = [
      makePM({ id: '1', name: 'Default PM', isDefault: true }),
      makePM({
        id: '2',
        name: 'Variant PM',
        variantCondition: { color: ['red', 'blue'] },
      }),
    ]
    const result = resolveProductionMethod(pms, { color: ['red'] })
    expect(result.productionMethod?.id).toBe('2')
    expect(result.fallback).toBe('variant_match')
  })

  it('falls back to default when variant conditions do not match', () => {
    const pms = [
      makePM({ id: '1', name: 'Default PM', isDefault: true }),
      makePM({
        id: '2',
        name: 'Variant PM',
        variantCondition: { color: ['red'] },
      }),
    ]
    const result = resolveProductionMethod(pms, { color: ['green'] })
    expect(result.productionMethod?.id).toBe('1')
    expect(result.fallback).toBe('default')
    expect(result.warnings).toContain('No production method matches the given variant conditions, falling back to default')
  })

  it('returns none when variant conditions do not match and no default', () => {
    const pms = [
      makePM({
        id: '1',
        name: 'Variant PM',
        variantCondition: { color: ['red'] },
      }),
    ]
    const result = resolveProductionMethod(pms, { color: ['green'] })
    expect(result.productionMethod).toBeNull()
    expect(result.fallback).toBe('none')
    expect(result.warnings).toContain('No matching production method')
  })

  it('AND-match: all condition keys must match', () => {
    const pms = [
      makePM({
        id: '1',
        name: 'Multi-key PM',
        variantCondition: { color: ['red'], size: ['L'] },
      }),
    ]
    // Only one key matches
    const result = resolveProductionMethod(pms, { color: ['red'], size: ['S'] })
    expect(result.productionMethod).toBeNull()
    expect(result.fallback).toBe('none')
  })

  it('AND-match: succeeds when all keys match', () => {
    const pms = [
      makePM({
        id: '1',
        name: 'Multi-key PM',
        variantCondition: { color: ['red'], size: ['L', 'XL'] },
      }),
    ]
    const result = resolveProductionMethod(pms, { color: ['red'], size: ['L'] })
    expect(result.productionMethod?.id).toBe('1')
    expect(result.fallback).toBe('variant_match')
  })

  it('ignores empty variant conditions object', () => {
    const pms = [makePM({ id: '1', name: 'Default PM', isDefault: true })]
    const result = resolveProductionMethod(pms, {})
    expect(result.productionMethod?.id).toBe('1')
    expect(result.fallback).toBe('default')
  })

  it('skips PMs with null/empty variant_condition when matching', () => {
    const pms = [
      makePM({ id: '1', name: 'No condition', variantCondition: null }),
      makePM({ id: '2', name: 'Default', isDefault: true }),
    ]
    const result = resolveProductionMethod(pms, { color: ['red'] })
    expect(result.productionMethod?.id).toBe('2')
    expect(result.fallback).toBe('default')
  })
})
