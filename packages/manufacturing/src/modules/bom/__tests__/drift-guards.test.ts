import {
  assertBomLineVariantBelongsToProduct,
  assertBomLineVariantOverrideBelongsToProduct,
} from '../lib/drift-guards'

// Minimal EntityManager stub — only findOne is touched. We inspect the filter
// that reaches it to assert tenant/org/deletedAt scoping, and we vary the
// return value to exercise each drift-guard branch.
type FakeVariant = {
  id: string
  product: { id: string } | string
} | null

function makeEm(
  lookup: (filter: Record<string, unknown>) => FakeVariant,
): { em: any; lastFilter: { value: Record<string, unknown> | null } } {
  const lastFilter = { value: null as Record<string, unknown> | null }
  const em = {
    async findOne(_entity: unknown, filter: Record<string, unknown>) {
      lastFilter.value = filter
      return lookup(filter)
    },
  }
  return { em, lastFilter }
}

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('assertBomLineVariantBelongsToProduct', () => {
  it('returns null when productId is missing (no-op)', async () => {
    const { em } = makeEm(() => null)
    const result = await assertBomLineVariantBelongsToProduct(em, null, 'variant-1', scope)
    expect(result).toBeNull()
  })

  it('returns null when productVariantId is missing (no-op)', async () => {
    const { em } = makeEm(() => null)
    const result = await assertBomLineVariantBelongsToProduct(em, 'prod-1', null, scope)
    expect(result).toBeNull()
  })

  it('scopes the lookup by tenantId + organizationId + deletedAt: null', async () => {
    const { em, lastFilter } = makeEm(() => ({ id: 'variant-1', product: { id: 'prod-1' } }))
    await assertBomLineVariantBelongsToProduct(em, 'prod-1', 'variant-1', scope)
    expect(lastFilter.value).toMatchObject({
      id: 'variant-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    })
  })

  it('returns a violation when the variant is not found in this tenant', async () => {
    const { em } = makeEm(() => null)
    const result = await assertBomLineVariantBelongsToProduct(em, 'prod-1', 'variant-1', scope)
    expect(result).not.toBeNull()
    expect(result?.path).toEqual(['productVariantId'])
    expect(result?.message).toContain('does not match any CatalogProductVariant in this tenant')
  })

  it('returns null when the variant belongs to the same product (populated reference)', async () => {
    const { em } = makeEm(() => ({ id: 'variant-1', product: { id: 'prod-1' } }))
    const result = await assertBomLineVariantBelongsToProduct(em, 'prod-1', 'variant-1', scope)
    expect(result).toBeNull()
  })

  it('returns null when variant.product is a string Reference (MikroORM shorthand)', async () => {
    const { em } = makeEm(() => ({ id: 'variant-1', product: 'prod-1' as unknown as { id: string } }))
    const result = await assertBomLineVariantBelongsToProduct(em, 'prod-1', 'variant-1', scope)
    expect(result).toBeNull()
  })

  it('returns a drift violation when the variant belongs to a different product', async () => {
    const { em } = makeEm(() => ({ id: 'variant-1', product: { id: 'prod-OTHER' } }))
    const result = await assertBomLineVariantBelongsToProduct(em, 'prod-1', 'variant-1', scope)
    expect(result).not.toBeNull()
    expect(result?.path).toEqual(['productVariantId'])
    expect(result?.message).toContain("belongs to product 'prod-OTHER', not 'prod-1'")
  })
})

describe('assertBomLineVariantOverrideBelongsToProduct', () => {
  it('returns null when productOverrideId is missing', async () => {
    const { em } = makeEm(() => null)
    expect(await assertBomLineVariantOverrideBelongsToProduct(em, null, 'variant-1', scope)).toBeNull()
  })

  it('returns null when productVariantOverrideId is missing', async () => {
    const { em } = makeEm(() => null)
    expect(await assertBomLineVariantOverrideBelongsToProduct(em, 'prod-1', null, scope)).toBeNull()
  })

  it('scopes the lookup by tenantId + organizationId + deletedAt: null', async () => {
    const { em, lastFilter } = makeEm(() => ({ id: 'variant-1', product: { id: 'prod-1' } }))
    await assertBomLineVariantOverrideBelongsToProduct(em, 'prod-1', 'variant-1', scope)
    expect(lastFilter.value).toMatchObject({
      id: 'variant-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    })
  })

  it('returns a violation when the variant is not found in this tenant', async () => {
    const { em } = makeEm(() => null)
    const result = await assertBomLineVariantOverrideBelongsToProduct(em, 'prod-1', 'variant-1', scope)
    expect(result?.path).toEqual(['productVariantOverrideId'])
    expect(result?.message).toContain('does not match any CatalogProductVariant in this tenant')
  })

  it('returns null when the override variant matches the override product', async () => {
    const { em } = makeEm(() => ({ id: 'variant-1', product: { id: 'prod-1' } }))
    expect(await assertBomLineVariantOverrideBelongsToProduct(em, 'prod-1', 'variant-1', scope)).toBeNull()
  })

  it('returns a drift violation when the variant belongs to a different product', async () => {
    const { em } = makeEm(() => ({ id: 'variant-1', product: { id: 'prod-OTHER' } }))
    const result = await assertBomLineVariantOverrideBelongsToProduct(em, 'prod-1', 'variant-1', scope)
    expect(result?.path).toEqual(['productVariantOverrideId'])
    expect(result?.message).toContain('override drift')
  })
})
