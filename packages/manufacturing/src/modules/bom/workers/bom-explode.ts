import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ProgressService, ProgressServiceContext } from '@open-mercato/core/modules/progress/lib/progressService'
import { BOM_EXPLODE_QUEUE, type BomExplodeJobPayload } from '../lib/queue'
import { BomHeader, BomLine, BomLineVariant } from '../data/entities'
import { explodeBom, type BomDataLoader } from '../lib/bom-explosion'

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
          materialId: l.materialId ?? null,
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
          materialOverrideId: v.materialOverrideId ?? null,
          unitOverrideId: v.unitOverrideId ?? null,
        }))
      },
    }

    const result = await explodeBom(
      {
        bomHeaderId,
        variantConditions: variantConditions ?? {},
        effectiveDate: new Date(effectiveDate),
        maxDepth,
      },
      loader,
    )

    await progressService.completeJob(
      progressJobId,
      {
        resultJson: {
          lines: result.lines,
          warnings: result.warnings,
          depth: result.depth,
          lineCount: result.lines.length,
        },
      },
      progressCtx,
    )
  } catch (error) {
    await progressService.failJob(
      progressJobId,
      { errorMessage: error instanceof Error ? error.message : 'BOM explosion failed' },
      progressCtx,
    )
  }
}
