import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { UomConversion, UnitOfMeasure } from '../data/entities'
import {
  uomConversionCreateSchema,
  uomConversionUpdateSchema,
  type UomConversionCreateInput,
  type UomConversionUpdateInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const ucCrudEvents: CrudEventsConfig = {
  module: 'product_master',
  entity: 'uom_conversion',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type UCSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  productId: string
  fromUomId: string
  toUomId: string
  factor: string
}

type UCUndoPayload = UndoPayload<UCSnapshot>

function resolveUomId(ref: unknown): string {
  return typeof ref === 'object' && ref !== null ? (ref as any).id : String(ref)
}

function snapshotUC(record: UomConversion): UCSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    productId: record.productId,
    fromUomId: resolveUomId(record.fromUom),
    toUomId: resolveUomId(record.toUom),
    factor: record.factor,
  }
}

const createUCCommand: CommandHandler<UomConversionCreateInput, { uomConversionId: string }> = {
  id: 'product_master.uomConversion.create',
  async execute(input, ctx) {
    const parsed = uomConversionCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const fromUom = await em.findOneOrFail(UnitOfMeasure, { id: parsed.fromUomId })
    const toUom = await em.findOneOrFail(UnitOfMeasure, { id: parsed.toUomId })

    const record = em.create(UomConversion, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      productId: parsed.productId,
      fromUom,
      toUom,
      factor: parsed.factor,
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
      events: ucCrudEvents,
    })

    return { uomConversionId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UomConversion, { id: result.uomConversionId }, { populate: ['fromUom', 'toUom'] })
    return record ? snapshotUC(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as UCSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create UoM conversion',
      resourceKind: 'manufacturing.uom_conversion',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UCUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UomConversion, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateUCCommand: CommandHandler<UomConversionUpdateInput, { uomConversionId: string }> = {
  id: 'product_master.uomConversion.update',
  async prepare(input, ctx) {
    requireId(input.id, 'UoM conversion ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(UomConversion, { id: input.id }, { populate: ['fromUom', 'toUom'] })
    return { before: record ? snapshotUC(record) : null }
  },
  async execute(input, ctx) {
    const parsed = uomConversionUpdateSchema.parse(input)
    requireId(parsed.id, 'UoM conversion ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UomConversion, { id: parsed.id, deletedAt: null }, { populate: ['fromUom', 'toUom'] })
    if (!record) {
      throw new CrudHttpError(404, { error: 'UoM conversion not found' })
    }

    const snapshotBefore = snapshotUC(record)
    let changed = false

    if (parsed.fromUomId !== undefined && parsed.fromUomId !== snapshotBefore.fromUomId) {
      const fromUom = await em.findOneOrFail(UnitOfMeasure, { id: parsed.fromUomId })
      record.fromUom = fromUom
      changed = true
    }

    if (parsed.toUomId !== undefined && parsed.toUomId !== snapshotBefore.toUomId) {
      const toUom = await em.findOneOrFail(UnitOfMeasure, { id: parsed.toUomId })
      record.toUom = toUom
      changed = true
    }

    if (parsed.factor !== undefined && parsed.factor !== record.factor) {
      record.factor = parsed.factor
      changed = true
    }

    if (!changed) {
      return { uomConversionId: record.id }
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
      events: ucCrudEvents,
    })

    return { uomConversionId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UomConversion, { id: result.uomConversionId }, { populate: ['fromUom', 'toUom'] })
    return record ? snapshotUC(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as UCSnapshot | undefined
    const after = snapshots.after as UCSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update UoM conversion',
      resourceKind: 'manufacturing.uom_conversion',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UCUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UomConversion, { id: before.id }, { populate: ['fromUom', 'toUom'] })
    if (!record) return
    const fromUom = await em.findOneOrFail(UnitOfMeasure, { id: before.fromUomId })
    const toUom = await em.findOneOrFail(UnitOfMeasure, { id: before.toUomId })
    record.fromUom = fromUom
    record.toUom = toUom
    record.factor = before.factor
    record.updatedAt = new Date()
    await em.flush()
  },
}

const deleteUCCommand: CommandHandler<{ id: string }, { uomConversionId: string }> = {
  id: 'product_master.uomConversion.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'UoM conversion ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(UomConversion, { id: input.id }, { populate: ['fromUom', 'toUom'] })
    return { before: record ? snapshotUC(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'UoM conversion ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UomConversion, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'UoM conversion not found' })
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
      events: ucCrudEvents,
    })

    return { uomConversionId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as UCSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete UoM conversion',
      resourceKind: 'manufacturing.uom_conversion',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UCUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UomConversion, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createUCCommand)
registerCommand(updateUCCommand)
registerCommand(deleteUCCommand)
