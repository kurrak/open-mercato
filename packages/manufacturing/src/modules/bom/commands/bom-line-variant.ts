import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BomLine, BomLineVariant } from '../data/entities'
import {
  bomLineVariantCreateSchema,
  bomLineVariantUpdateSchema,
  type BomLineVariantCreateInput,
  type BomLineVariantUpdateInput,
} from '../data/validators'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

type BLVSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  bomLineId: string
  variantId: string | null
  variantCondition: Record<string, unknown> | null
  quantityOverride: string | null
  materialOverrideId: string | null
  unitOverrideId: string | null
  notes: string | null
}

type BLVUndoPayload = UndoPayload<BLVSnapshot>

function snapshotBLV(record: BomLineVariant): BLVSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    bomLineId: typeof record.bomLine === 'object' ? record.bomLine.id : (record.bomLine as string),
    variantId: record.variantId ?? null,
    variantCondition: record.variantCondition ?? null,
    quantityOverride: record.quantityOverride ?? null,
    materialOverrideId: record.materialOverrideId ?? null,
    unitOverrideId: record.unitOverrideId ?? null,
    notes: record.notes ?? null,
  }
}

const createBLVCommand: CommandHandler<BomLineVariantCreateInput, { bomLineVariantId: string }> = {
  id: 'bom.bom_line_variant.create',
  async execute(input, ctx) {
    const parsed = bomLineVariantCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const bomLine = await em.findOneOrFail(BomLine, { id: parsed.bomLineId })

    const record = em.create(BomLineVariant, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      bomLine,
      variantId: parsed.variantId ?? null,
      variantCondition: parsed.variantCondition ?? null,
      quantityOverride: parsed.quantityOverride ?? null,
      materialOverrideId: parsed.materialOverrideId ?? null,
      unitOverrideId: parsed.unitOverrideId ?? null,
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
      events: undefined,
    })

    return { bomLineVariantId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLineVariant, { id: result.bomLineVariantId }, { populate: ['bomLine'] })
    return record ? snapshotBLV(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as BLVSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create BOM line variant',
      resourceKind: 'manufacturing.bom_line_variant',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BLVUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLineVariant, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateBLVCommand: CommandHandler<BomLineVariantUpdateInput, { bomLineVariantId: string }> = {
  id: 'bom.bom_line_variant.update',
  async prepare(input, ctx) {
    requireId(input.id, 'BOM line variant ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(BomLineVariant, { id: input.id }, { populate: ['bomLine'] })
    return { before: record ? snapshotBLV(record) : null }
  },
  async execute(input, ctx) {
    const parsed = bomLineVariantUpdateSchema.parse(input)
    requireId(parsed.id, 'BOM line variant ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLineVariant, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'BOM line variant not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'variantId', 'variantCondition', 'quantityOverride', 'materialOverrideId', 'unitOverrideId', 'notes',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { bomLineVariantId: record.id }
    }

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
      events: undefined,
    })

    return { bomLineVariantId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLineVariant, { id: result.bomLineVariantId }, { populate: ['bomLine'] })
    return record ? snapshotBLV(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as BLVSnapshot | undefined
    const after = snapshots.after as BLVSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update BOM line variant',
      resourceKind: 'manufacturing.bom_line_variant',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BLVUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLineVariant, { id: before.id })
    if (!record) return
    Object.assign(record, {
      variantId: before.variantId,
      variantCondition: before.variantCondition,
      quantityOverride: before.quantityOverride,
      materialOverrideId: before.materialOverrideId,
      unitOverrideId: before.unitOverrideId,
      notes: before.notes,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteBLVCommand: CommandHandler<{ id: string }, { bomLineVariantId: string }> = {
  id: 'bom.bom_line_variant.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'BOM line variant ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(BomLineVariant, { id: input.id }, { populate: ['bomLine'] })
    return { before: record ? snapshotBLV(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'BOM line variant ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLineVariant, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'BOM line variant not found' })
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
      events: undefined,
    })

    return { bomLineVariantId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as BLVSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete BOM line variant',
      resourceKind: 'manufacturing.bom_line_variant',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BLVUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomLineVariant, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createBLVCommand)
registerCommand(updateBLVCommand)
registerCommand(deleteBLVCommand)
