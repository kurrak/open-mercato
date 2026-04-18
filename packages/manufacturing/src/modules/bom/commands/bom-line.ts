import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BomHeader, BomLine } from '../data/entities'
import {
  bomLineCreateSchema,
  bomLineUpdateSchema,
  collectBomLineInvariantViolations,
  type BomLineCreateInput,
  type BomLineUpdateInput,
  type InvariantViolation,
} from '../data/validators'
import { assertBomLineVariantBelongsToProduct } from '../lib/drift-guards'
import { detectBomCycle } from '../lib/cycle-detection'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

// Converts a list of invariant violations into a 400 CrudHttpError whose body
// carries both a human summary (first message) and a structured fieldErrors
// map consumable by CrudForm. Mirrors the shape produced by
// createCrudFormError on the client so both layers share one contract.
function buildInvariantHttpError(violations: InvariantViolation[]): CrudHttpError {
  const fieldErrors: Record<string, string> = {}
  for (const v of violations) {
    const key = v.path.length > 0 ? v.path.join('.') : '_form'
    if (!fieldErrors[key]) fieldErrors[key] = v.message
  }
  return new CrudHttpError(400, {
    error: violations[0]?.message ?? 'Validation failed',
    fieldErrors,
  })
}

// TODO (UI): product_resolve_key namespace probe against ConfigAttribute.key
// on the master product is warning-only per Graceful Incompleteness. Surface
// it at UI-side pre-save via POST /api/manufacturing/configurator/validate-namespace
// (see spec d §API Contracts / namespace probe pattern). The command path
// intentionally does NOT run the probe — callers save draft-state BomLines
// before the configurator is defined and should not be blocked.

const bomLineCrudEvents: CrudEventsConfig = {
  module: 'bom',
  entity: 'bom_line',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type BomLineSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  bomHeaderId: string
  lineType: string
  productId: string | null
  productVariantId: string | null
  productResolveKey: string | null
  childBomHeaderId: string | null
  netQuantity: string | null
  grossQuantity: string | null
  scrapPercentage: string
  uomId: string | null
  variantCondition: Record<string, unknown> | null
  operationTemplateId: string | null
  sortOrder: number
  validFrom: string | null
  validTo: string | null
  isConsumable: boolean
  notes: string | null
}

type BomLineUndoPayload = UndoPayload<BomLineSnapshot>

function extractBomHeaderId(record: BomLine): string {
  const ref = record.bomHeader
  if (typeof ref === 'object' && ref !== null && 'id' in ref) return (ref as { id: string }).id
  return String(ref)
}

function snapshotBomLine(record: BomLine): BomLineSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    bomHeaderId: extractBomHeaderId(record),
    lineType: record.lineType,
    productId: record.productId ?? null,
    productVariantId: record.productVariantId ?? null,
    productResolveKey: record.productResolveKey ?? null,
    childBomHeaderId: record.childBomHeaderId ?? null,
    netQuantity: record.netQuantity ?? null,
    grossQuantity: record.grossQuantity ?? null,
    scrapPercentage: record.scrapPercentage,
    uomId: record.uomId ?? null,
    variantCondition: record.variantCondition ?? null,
    operationTemplateId: record.operationTemplateId ?? null,
    sortOrder: record.sortOrder,
    validFrom: record.validFrom?.toISOString() ?? null,
    validTo: record.validTo?.toISOString() ?? null,
    isConsumable: record.isConsumable,
    notes: record.notes ?? null,
  }
}

async function checkBomCycle(em: EntityManager, parentBomHeaderId: string, childBomHeaderId: string): Promise<void> {
  const cyclePath = await detectBomCycle(
    parentBomHeaderId,
    childBomHeaderId,
    async (bomHeaderId: string) => {
      const childLines = await em.find(BomLine, {
        bomHeader: bomHeaderId,
        childBomHeaderId: { $ne: null },
        deletedAt: null,
      })
      return childLines.map((l) => ({
        bomHeaderId: typeof l.bomHeader === 'object' && l.bomHeader !== null && 'id' in l.bomHeader ? (l.bomHeader as { id: string }).id : String(l.bomHeader),
        childBomHeaderId: l.childBomHeaderId ?? null,
      }))
    },
  )
  if (cyclePath) {
    throw new CrudHttpError(400, { error: `Circular BOM reference detected: ${cyclePath.join(' → ')}` })
  }
}

const createBomLineCommand: CommandHandler<BomLineCreateInput, { bomLineId: string }> = {
  id: 'bom.bom_line.create',
  async execute(input, ctx) {
    const parsed = bomLineCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    if (parsed.childBomHeaderId) {
      await checkBomCycle(em, parsed.bomHeaderId, parsed.childBomHeaderId)
    }

    const driftViolation = await assertBomLineVariantBelongsToProduct(
      em,
      parsed.productId,
      parsed.productVariantId,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (driftViolation) throw buildInvariantHttpError([driftViolation])

    const bomHeader = await em.findOneOrFail(BomHeader, { id: parsed.bomHeaderId })
    const record = em.create(BomLine, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      bomHeader,
      lineType: parsed.lineType ?? 'material',
      productId: parsed.productId ?? null,
      productVariantId: parsed.productVariantId ?? null,
      productResolveKey: parsed.productResolveKey ?? null,
      childBomHeaderId: parsed.childBomHeaderId ?? null,
      netQuantity: parsed.netQuantity ?? null,
      grossQuantity: parsed.grossQuantity ?? null,
      scrapPercentage: parsed.scrapPercentage ?? '0',
      uomId: parsed.uomId ?? null,
      variantCondition: parsed.variantCondition ?? null,
      operationTemplateId: parsed.operationTemplateId ?? null,
      sortOrder: parsed.sortOrder ?? 0,
      validFrom: parsed.validFrom ?? null,
      validTo: parsed.validTo ?? null,
      isConsumable: parsed.isConsumable ?? false,
      notes: parsed.notes ?? null,
    })
    em.persist(record)
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: bomLineCrudEvents,
    })

    return { bomLineId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLine, { id: result.bomLineId })
    return record ? snapshotBomLine(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as BomLineSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create BOM line',
      resourceKind: 'manufacturing.bom_line',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BomLineUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLine, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateBomLineCommand: CommandHandler<BomLineUpdateInput, { bomLineId: string }> = {
  id: 'bom.bom_line.update',
  async prepare(input, ctx) {
    requireId(input.id, 'BOM line ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(BomLine, { id: input.id })
    return { before: record ? snapshotBomLine(record) : null }
  },
  async execute(input, ctx) {
    const parsed = bomLineUpdateSchema.parse(input)
    requireId(parsed.id, 'BOM line ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLine, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'BOM line not found' })
    }

    if (parsed.childBomHeaderId) {
      const parentBomHeaderId = extractBomHeaderId(record)
      await checkBomCycle(em, parentBomHeaderId, parsed.childBomHeaderId)
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'lineType', 'productId', 'productVariantId', 'productResolveKey',
      'childBomHeaderId', 'netQuantity', 'grossQuantity',
      'scrapPercentage', 'uomId', 'variantCondition', 'operationTemplateId',
      'sortOrder', 'validFrom', 'validTo', 'isConsumable', 'notes',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { bomLineId: record.id }
    }

    // Invariant check on the merged post-update state. Zod only validates the
    // partial patch in bomLineUpdateSchema; the command must see the full state.
    const effectiveState = {
      lineType: 'lineType' in changes ? (changes.lineType.to as string) : record.lineType,
      productId: 'productId' in changes ? (changes.productId.to as string | null) : (record.productId ?? null),
      productVariantId: 'productVariantId' in changes
        ? (changes.productVariantId.to as string | null)
        : (record.productVariantId ?? null),
      productResolveKey: 'productResolveKey' in changes
        ? (changes.productResolveKey.to as string | null)
        : (record.productResolveKey ?? null),
    }
    const violations: InvariantViolation[] = collectBomLineInvariantViolations(effectiveState)
    const driftViolation = await assertBomLineVariantBelongsToProduct(
      em,
      effectiveState.productId,
      effectiveState.productVariantId,
      { tenantId: record.tenantId, organizationId: record.organizationId },
    )
    if (driftViolation) violations.push(driftViolation)
    if (violations.length > 0) throw buildInvariantHttpError(violations)

    for (const [key, change] of Object.entries(changes)) {
      ;(record as unknown as Record<string, unknown>)[key] = change.to
    }
    record.updatedAt = new Date()
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: bomLineCrudEvents,
    })

    return { bomLineId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLine, { id: result.bomLineId })
    return record ? snapshotBomLine(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as BomLineSnapshot | undefined
    const after = snapshots.after as BomLineSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update BOM line',
      resourceKind: 'manufacturing.bom_line',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BomLineUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLine, { id: before.id })
    if (!record) return
    Object.assign(record, {
      lineType: before.lineType,
      productId: before.productId,
      productVariantId: before.productVariantId,
      productResolveKey: before.productResolveKey,
      childBomHeaderId: before.childBomHeaderId,
      netQuantity: before.netQuantity,
      grossQuantity: before.grossQuantity,
      scrapPercentage: before.scrapPercentage,
      uomId: before.uomId,
      variantCondition: before.variantCondition,
      operationTemplateId: before.operationTemplateId,
      sortOrder: before.sortOrder,
      validFrom: before.validFrom ? new Date(before.validFrom) : null,
      validTo: before.validTo ? new Date(before.validTo) : null,
      isConsumable: before.isConsumable,
      notes: before.notes,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteBomLineCommand: CommandHandler<{ id: string }, { bomLineId: string }> = {
  id: 'bom.bom_line.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'BOM line ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(BomLine, { id: input.id })
    return { before: record ? snapshotBomLine(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'BOM line ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLine, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'BOM line not found' })
    }
    record.deletedAt = new Date()
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: bomLineCrudEvents,
    })

    return { bomLineId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as BomLineSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete BOM line',
      resourceKind: 'manufacturing.bom_line',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BomLineUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLine, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createBomLineCommand)
registerCommand(updateBomLineCommand)
registerCommand(deleteBomLineCommand)
