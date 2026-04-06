import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BomHeader } from '../data/entities'
import {
  bomHeaderCreateSchema,
  bomHeaderUpdateSchema,
  type BomHeaderCreateInput,
  type BomHeaderUpdateInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const bomCrudEvents: CrudEventsConfig = {
  module: 'bom',
  entity: 'bom_header',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type BomHeaderSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  productId: string
  name: string
  bomUsage: string
  isPhantom: boolean
  isActive: boolean
  version: number
  notes: string | null
}

type BomHeaderUndoPayload = UndoPayload<BomHeaderSnapshot>

function snapshotBomHeader(record: BomHeader): BomHeaderSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    productId: record.productId,
    name: record.name,
    bomUsage: record.bomUsage,
    isPhantom: record.isPhantom,
    isActive: record.isActive,
    version: record.version,
    notes: record.notes ?? null,
  }
}

const createBomHeaderCommand: CommandHandler<BomHeaderCreateInput, { bomHeaderId: string }> = {
  id: 'bom.bom_header.create',
  async execute(input, ctx) {
    const parsed = bomHeaderCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = em.create(BomHeader, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      productId: parsed.productId,
      name: parsed.name,
      bomUsage: parsed.bomUsage ?? 'production',
      isPhantom: parsed.isPhantom ?? false,
      isActive: parsed.isActive ?? true,
      version: parsed.version ?? 1,
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
      events: bomCrudEvents,
    })

    return { bomHeaderId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomHeader, { id: result.bomHeaderId })
    return record ? snapshotBomHeader(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as BomHeaderSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create BOM header',
      resourceKind: 'manufacturing.bom',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BomHeaderUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomHeader, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateBomHeaderCommand: CommandHandler<BomHeaderUpdateInput, { bomHeaderId: string }> = {
  id: 'bom.bom_header.update',
  async prepare(input, ctx) {
    requireId(input.id, 'BOM header ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(BomHeader, { id: input.id })
    return { before: record ? snapshotBomHeader(record) : null }
  },
  async execute(input, ctx) {
    const parsed = bomHeaderUpdateSchema.parse(input)
    requireId(parsed.id, 'BOM header ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomHeader, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'BOM header not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'name', 'bomUsage', 'isPhantom', 'isActive', 'version', 'notes',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { bomHeaderId: record.id }
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
      events: bomCrudEvents,
    })

    return { bomHeaderId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomHeader, { id: result.bomHeaderId })
    return record ? snapshotBomHeader(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as BomHeaderSnapshot | undefined
    const after = snapshots.after as BomHeaderSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update BOM header',
      resourceKind: 'manufacturing.bom',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BomHeaderUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomHeader, { id: before.id })
    if (!record) return
    Object.assign(record, {
      name: before.name,
      bomUsage: before.bomUsage,
      isPhantom: before.isPhantom,
      isActive: before.isActive,
      version: before.version,
      notes: before.notes,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteBomHeaderCommand: CommandHandler<{ id: string }, { bomHeaderId: string }> = {
  id: 'bom.bom_header.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'BOM header ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(BomHeader, { id: input.id })
    return { before: record ? snapshotBomHeader(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'BOM header ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomHeader, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'BOM header not found' })
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
      events: bomCrudEvents,
    })

    return { bomHeaderId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as BomHeaderSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete BOM header',
      resourceKind: 'manufacturing.bom',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BomHeaderUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BomHeader, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createBomHeaderCommand)
registerCommand(updateBomHeaderCommand)
registerCommand(deleteBomHeaderCommand)
