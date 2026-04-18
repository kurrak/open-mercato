import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import type { InvariantViolation } from '../data/validators'

// Tenant/org scope required on every drift-guard query — a variant UUID by
// itself is not authoritative across tenants, and a match on an out-of-tenant
// row would either mislead the drift check or (worse) silently let a BomLine
// point at a foreign CatalogProductVariant. Soft-deleted variants are also
// excluded.

function extractProductId(variant: CatalogProductVariant): string {
  const ref = variant.product as unknown
  if (typeof ref === 'object' && ref !== null && 'id' in ref) {
    return (ref as { id: string }).id
  }
  return String(ref)
}

// Drift guard: when a BomLine pins both product_id and product_variant_id, the
// variant must belong to that product (same tenant, not soft-deleted).
// Spec b §BomLine Constraints.
export async function assertBomLineVariantBelongsToProduct(
  em: EntityManager,
  productId: string | null | undefined,
  productVariantId: string | null | undefined,
  scope: { tenantId: string; organizationId: string },
): Promise<InvariantViolation | null> {
  if (!productId || !productVariantId) return null
  const variant = await em.findOne(CatalogProductVariant, {
    id: productVariantId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!variant) {
    return {
      path: ['productVariantId'],
      message: `product_variant_id '${productVariantId}' does not match any CatalogProductVariant in this tenant`,
    }
  }
  const variantProductId = extractProductId(variant)
  if (variantProductId !== productId) {
    return {
      path: ['productVariantId'],
      message: `drift: product_variant '${productVariantId}' belongs to product '${variantProductId}', not '${productId}'`,
    }
  }
  return null
}

// Drift guard: when an override pins both product_override_id and
// product_variant_override_id, the variant must belong to that override
// product (same tenant, not soft-deleted). Spec b §BomLineVariant Constraints.
export async function assertBomLineVariantOverrideBelongsToProduct(
  em: EntityManager,
  productOverrideId: string | null | undefined,
  productVariantOverrideId: string | null | undefined,
  scope: { tenantId: string; organizationId: string },
): Promise<InvariantViolation | null> {
  if (!productOverrideId || !productVariantOverrideId) return null
  const variant = await em.findOne(CatalogProductVariant, {
    id: productVariantOverrideId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!variant) {
    return {
      path: ['productVariantOverrideId'],
      message: `product_variant_override_id '${productVariantOverrideId}' does not match any CatalogProductVariant in this tenant`,
    }
  }
  const variantProductId = extractProductId(variant)
  if (variantProductId !== productOverrideId) {
    return {
      path: ['productVariantOverrideId'],
      message: `override drift: product_variant '${productVariantOverrideId}' belongs to product '${variantProductId}', not '${productOverrideId}'`,
    }
  }
  return null
}
