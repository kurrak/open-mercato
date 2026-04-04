import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { UnitOfMeasure } from '../data/entities'
import {
  unitOfMeasureCreateSchema,
  unitOfMeasureUpdateSchema,
  type UnitOfMeasureCreateInput,
  type UnitOfMeasureUpdateInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const uomCrudEvents: CrudEventsConfig = {
  module: 'manufacturing',
  entity: 'unit_of_measure',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type UomSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  code: string
  name: string
  uomType: string
  isActive: boolean
}

type UomUndoPayload = UndoPayload<UomSnapshot>

function snapshotUom(record: UnitOfMeasure): UomSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    code: record.code,
    name: record.name,
    uomType: record.uomType,
    isActive: record.isActive,
  }
}

const createUomCommand: CommandHandler<UnitOfMeasureCreateInput, { unitOfMeasureId: string }> = {
  id: 'product_master.unitOfMeasure.create',
  async execute(input, ctx) {
    const parsed = unitOfMeasureCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const existing = await em.findOne(UnitOfMeasure, {
      code: parsed.code,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw new CrudHttpError(409, { error: 'Unit of measure with this code already exists' })
    }

    const record = em.create(UnitOfMeasure, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      code: parsed.code,
      name: parsed.name,
      uomType: parsed.uomType,
      isActive: parsed.isActive ?? true,
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
      events: uomCrudEvents,
    })

    return { unitOfMeasureId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UnitOfMeasure, { id: result.unitOfMeasureId })
    return record ? snapshotUom(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as UomSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create unit of measure',
      resourceKind: 'manufacturing.unit_of_measure',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UomUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UnitOfMeasure, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateUomCommand: CommandHandler<UnitOfMeasureUpdateInput, { unitOfMeasureId: string }> = {
  id: 'product_master.unitOfMeasure.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Unit of measure ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(UnitOfMeasure, { id: input.id })
    return { before: record ? snapshotUom(record) : null }
  },
  async execute(input, ctx) {
    const parsed = unitOfMeasureUpdateSchema.parse(input)
    requireId(parsed.id, 'Unit of measure ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UnitOfMeasure, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Unit of measure not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'code', 'name', 'uomType', 'isActive',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { unitOfMeasureId: record.id }
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
      events: uomCrudEvents,
    })

    return { unitOfMeasureId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UnitOfMeasure, { id: result.unitOfMeasureId })
    return record ? snapshotUom(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as UomSnapshot | undefined
    const after = snapshots.after as UomSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update unit of measure',
      resourceKind: 'manufacturing.unit_of_measure',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UomUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UnitOfMeasure, { id: before.id })
    if (!record) return
    Object.assign(record, {
      code: before.code,
      name: before.name,
      uomType: before.uomType,
      isActive: before.isActive,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteUomCommand: CommandHandler<{ id: string }, { unitOfMeasureId: string }> = {
  id: 'product_master.unitOfMeasure.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Unit of measure ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(UnitOfMeasure, { id: input.id })
    return { before: record ? snapshotUom(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Unit of measure ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UnitOfMeasure, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Unit of measure not found' })
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
      events: uomCrudEvents,
    })

    return { unitOfMeasureId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as UomSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete unit of measure',
      resourceKind: 'manufacturing.unit_of_measure',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UomUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(UnitOfMeasure, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createUomCommand)
registerCommand(updateUomCommand)
registerCommand(deleteUomCommand)
