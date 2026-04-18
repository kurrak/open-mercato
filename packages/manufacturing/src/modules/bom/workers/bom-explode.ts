import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ProgressService, ProgressServiceContext } from '@open-mercato/core/modules/progress/lib/progressService'
import { CatalogProduct, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { ConfigAttribute } from '../../configurator/data/entities'
import { BOM_EXPLODE_QUEUE, type BomExplodeJobPayload } from '../lib/queue'
import { BomHeader, BomLine, BomLineVariant } from '../data/entities'
import {
  explodeBom,
  type BomDataLoader,
  type ExplosionContext,
  type ConfigAttributeData,
  type CatalogProductData,
  type CatalogProductVariantData,
} from '../lib/bom-explosion'
import { emitBomEvent } from '../events'

type PreloadScope = { tenantId: string; organizationId: string }

// Pre-loads the three maps consumed by explodeBom's Step 2 (type-directed
// dynamic product resolution) and Step 3 (BomLineVariant override pair):
//
//   - configAttributesByKey: all ConfigAttribute rows for the top-level
//     master product (reused at every recursion level — matches the
//     namespace rule that governs variant_condition keys).
//   - catalogProducts: every CatalogProduct UUID that might appear on the
//     output — collected from (a) static BomLine.product_id, (b) static
//     BomLineVariant.product_override_id, (c) variantConditions values for
//     attributes with attribute_type='product'.
//   - catalogProductVariants: same for variants — product_variant_id,
//     product_variant_override_id, variantConditions values for
//     attribute_type='product_variant'.
//
// Walks the BOM graph once (separate from explodeBom's own recursion) to
// collect UUIDs. The duplicate traversal is acceptable at this scope —
// both passes hit the same rows through the same em, and the second pass
// benefits from MikroORM's identity-map cache for PK lookups.
async function buildExplosionContext(
  em: EntityManager,
  topBomHeaderId: string,
  variantConditions: Record<string, string>,
  scope: PreloadScope,
): Promise<ExplosionContext> {
  const encScope = scope

  // Top-level master product → ConfigAttribute map.
  const [topHeader] = await findWithDecryption(
    em, BomHeader,
    { id: topBomHeaderId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
    {}, encScope,
  )

  const configAttributesByKey = new Map<string, ConfigAttributeData>()
  if (topHeader) {
    const attrs = await findWithDecryption(
      em, ConfigAttribute,
      { productId: topHeader.productId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      {}, encScope,
    )
    for (const attr of attrs) {
      configAttributesByKey.set(attr.key, {
        key: attr.key,
        attributeType: attr.attributeType as ConfigAttributeData['attributeType'],
      })
    }
  }

  // Walk the BOM graph to collect catalog UUIDs referenced on any line or
  // override pair. Single-shot BFS; the visited set prevents cycles.
  const productIds = new Set<string>()
  const variantIds = new Set<string>()
  const visited = new Set<string>()
  const pending: string[] = [topBomHeaderId]
  while (pending.length > 0) {
    const bomId = pending.shift() as string
    if (visited.has(bomId)) continue
    visited.add(bomId)

    const lines = await findWithDecryption(
      em, BomLine,
      { bomHeader: bomId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      {}, encScope,
    )
    const lineIds: string[] = []
    for (const line of lines) {
      lineIds.push(line.id)
      if (line.productId) productIds.add(line.productId)
      if (line.productVariantId) variantIds.add(line.productVariantId)
      if (line.childBomHeaderId && !visited.has(line.childBomHeaderId)) {
        pending.push(line.childBomHeaderId)
      }
    }

    if (lineIds.length > 0) {
      const variants = await findWithDecryption(
        em, BomLineVariant,
        { bomLine: { $in: lineIds }, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
        {}, encScope,
      )
      for (const v of variants) {
        if (v.productOverrideId) productIds.add(v.productOverrideId)
        if (v.productVariantOverrideId) variantIds.add(v.productVariantOverrideId)
      }
    }
  }

  // UUIDs from variantConditions — partitioned by the master product's
  // attribute_type. Values for attribute types that don't drive dynamic
  // resolution (enum, boolean, etc.) are ignored here; Step 2 will surface
  // them as warnings if a BomLine references them via product_resolve_key.
  for (const [key, value] of Object.entries(variantConditions)) {
    if (!value) continue
    const attr = configAttributesByKey.get(key)
    if (!attr) continue
    if (attr.attributeType === 'product') productIds.add(value)
    else if (attr.attributeType === 'product_variant') variantIds.add(value)
  }

  const catalogProducts = new Map<string, CatalogProductData>()
  if (productIds.size > 0) {
    const rows = await findWithDecryption(
      em, CatalogProduct,
      { id: { $in: [...productIds] }, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      {}, encScope,
    )
    for (const p of rows) catalogProducts.set(p.id, { id: p.id })
  }

  const catalogProductVariants = new Map<string, CatalogProductVariantData>()
  if (variantIds.size > 0) {
    const rows = await findWithDecryption(
      em, CatalogProductVariant,
      { id: { $in: [...variantIds] }, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      {}, encScope,
    )
    for (const v of rows) {
      const ref = v.product as unknown
      const productId = typeof ref === 'object' && ref !== null && 'id' in ref
        ? (ref as { id: string }).id
        : String(ref)
      catalogProductVariants.set(v.id, { id: v.id, productId })
    }
  }

  return { configAttributesByKey, catalogProducts, catalogProductVariants }
}

export const metadata: WorkerMeta = {
  queue: BOM_EXPLODE_QUEUE,
  id: 'bom:explode',
  concurrency: 2,
}

export default async function handle(
  job: QueuedJob<BomExplodeJobPayload>,
  _ctx: JobContext,
): Promise<void> {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const progressService = container.resolve('progressService') as ProgressService

  const { progressJobId, bomHeaderId, variantConditions, effectiveDate, maxDepth, scope } = job.payload
  const progressCtx: ProgressServiceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.userId,
  }
  const encScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }

  try {
    await progressService.startJob(progressJobId, progressCtx)

    const loader: BomDataLoader = {
      async loadHeader(id: string) {
        const [header] = await findWithDecryption(
          em, BomHeader,
          { id, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
          {}, encScope,
        )
        if (!header) return null
        return {
          id: header.id,
          productId: header.productId,
          isPhantom: header.isPhantom,
          isActive: header.isActive,
        }
      },

      async loadLines(headerId: string) {
        const lines = await findWithDecryption(
          em, BomLine,
          { bomHeader: headerId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
          { orderBy: { sortOrder: 'ASC' } }, encScope,
        )
        return lines.map((l) => ({
          id: l.id,
          bomHeaderId: typeof l.bomHeader === 'object' ? (l.bomHeader as BomHeader).id : String(l.bomHeader),
          lineType: l.lineType as 'material' | 'semi_product',
          productId: l.productId ?? null,
          productVariantId: l.productVariantId ?? null,
          productResolveKey: l.productResolveKey ?? null,
          childBomHeaderId: l.childBomHeaderId ?? null,
          netQuantity: l.netQuantity ?? null,
          grossQuantity: l.grossQuantity ?? null,
          scrapPercentage: l.scrapPercentage ?? '0',
          uomId: l.uomId ?? null,
          variantCondition: l.variantCondition ?? null,
          operationTemplateId: l.operationTemplateId ?? null,
          sortOrder: l.sortOrder,
          validFrom: l.validFrom ?? null,
          validTo: l.validTo ?? null,
          isConsumable: l.isConsumable,
        }))
      },

      async loadLineVariants(lineIds: string[]) {
        if (lineIds.length === 0) return []
        const variants = await findWithDecryption(
          em, BomLineVariant,
          { bomLine: { $in: lineIds }, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
          {}, encScope,
        )
        return variants.map((v) => ({
          id: v.id,
          bomLineId: typeof v.bomLine === 'object' ? (v.bomLine as BomLine).id : String(v.bomLine),
          variantId: v.variantId ?? null,
          variantCondition: v.variantCondition ?? null,
          quantityOverride: v.quantityOverride ?? null,
          productOverrideId: v.productOverrideId ?? null,
          productVariantOverrideId: v.productVariantOverrideId ?? null,
          unitOverrideId: v.unitOverrideId ?? null,
        }))
      },
    }

    const context = await buildExplosionContext(em, bomHeaderId, variantConditions, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    const result = await explodeBom(
      {
        bomHeaderId,
        variantConditions,
        effectiveDate: new Date(effectiveDate),
        maxDepth,
      },
      loader,
      context,
    )

    await progressService.completeJob(
      progressJobId,
      {
        resultSummary: {
          lines: result.lines,
          warnings: result.warnings,
          depth: result.depth,
          lineCount: result.lines.length,
        },
      },
      progressCtx,
    )

    await emitBomEvent('bom.explosion.completed', {
      bomHeaderId,
      lineCount: result.lines.length,
      depth: result.depth,
      warningCount: result.warnings.length,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
  } catch (error) {
    await progressService.failJob(
      progressJobId,
      { errorMessage: error instanceof Error ? error.message : 'BOM explosion failed' },
      progressCtx,
    )
  }
}
