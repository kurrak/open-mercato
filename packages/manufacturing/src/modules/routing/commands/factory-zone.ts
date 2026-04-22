import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { FactoryZone } from '../data/entities'
import {
  factoryZoneCreateSchema,
  factoryZoneUpdateSchema,
  type FactoryZoneCreateInput,
  type FactoryZoneUpdateInput,
} from '../data/validators'

type FactoryZoneSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string
  locationId: string | null
  isActive: boolean
  notes: string | null
}

type FactoryZoneUndoPayload = UndoPayload<FactoryZoneSnapshot>

function snapshotFactoryZone(record: FactoryZone): FactoryZoneSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code,
    locationId: record.locationId ?? null,
    isActive: record.isActive,
    notes: record.notes ?? null,
  }
}

const createFactoryZoneCommand: CommandHandler<FactoryZoneCreateInput, { factoryZoneId: string }> = {
  id: 'routing.factory_zone.create',
  async execute(input, ctx) {
    const parsed = factoryZoneCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // The DB UNIQUE(organization_id, tenant_id, code) counts soft-
    // deleted rows. Inserting after a soft-delete on the same code
    // would hit a PG UNIQUE violation and surface as a 500 to the
    // user. Resurrect the soft-deleted row instead: clear deletedAt
    // and overwrite fields with the new values. An active collision
    // throws 409. Long-term fix is a partial UNIQUE index
    // (WHERE deleted_at IS NULL).
    const existing = await em.findOne(FactoryZone, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      code: parsed.code,
    })

    let record: FactoryZone
    if (existing && existing.deletedAt != null) {
      existing.deletedAt = null
      existing.name = parsed.name
      existing.locationId = parsed.locationId ?? null
      existing.isActive = parsed.isActive ?? true
      existing.notes = parsed.notes ?? null
      existing.updatedAt = new Date()
      record = existing
    } else if (existing) {
      throw new CrudHttpError(409, { error: 'Factory zone with this code already exists.' })
    } else {
      record = em.create(FactoryZone, {
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        name: parsed.name,
        code: parsed.code,
        locationId: parsed.locationId ?? null,
        isActive: parsed.isActive ?? true,
        notes: parsed.notes ?? null,
      })
      em.persist(record)
    }
    await em.flush()

    return { factoryZoneId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(FactoryZone, { id: result.factoryZoneId })
    return record ? snapshotFactoryZone(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as FactoryZoneSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create factory zone',
      resourceKind: 'manufacturing.factory_zone',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FactoryZoneUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(FactoryZone, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateFactoryZoneCommand: CommandHandler<FactoryZoneUpdateInput, { factoryZoneId: string }> = {
  id: 'routing.factory_zone.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Factory zone ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(FactoryZone, { id: input.id })
    return { before: record ? snapshotFactoryZone(record) : null }
  },
  async execute(input, ctx) {
    const parsed = factoryZoneUpdateSchema.parse(input)
    requireId(parsed.id, 'Factory zone ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(FactoryZone, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Factory zone not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'name', 'code', 'locationId', 'isActive', 'notes',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { factoryZoneId: record.id }
    }

    for (const [key, change] of Object.entries(changes)) {
      ;(record as unknown as Record<string, unknown>)[key] = change.to
    }
    record.updatedAt = new Date()
    await em.flush()

    return { factoryZoneId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(FactoryZone, { id: result.factoryZoneId })
    return record ? snapshotFactoryZone(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as FactoryZoneSnapshot | undefined
    const after = snapshots.after as FactoryZoneSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update factory zone',
      resourceKind: 'manufacturing.factory_zone',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FactoryZoneUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(FactoryZone, { id: before.id })
    if (!record) return
    Object.assign(record, {
      name: before.name,
      code: before.code,
      locationId: before.locationId,
      isActive: before.isActive,
      notes: before.notes,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteFactoryZoneCommand: CommandHandler<{ id: string }, { factoryZoneId: string }> = {
  id: 'routing.factory_zone.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Factory zone ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(FactoryZone, { id: input.id })
    return { before: record ? snapshotFactoryZone(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Factory zone ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(FactoryZone, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Factory zone not found' })
    }
    record.deletedAt = new Date()
    await em.flush()

    return { factoryZoneId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as FactoryZoneSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete factory zone',
      resourceKind: 'manufacturing.factory_zone',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FactoryZoneUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(FactoryZone, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createFactoryZoneCommand)
registerCommand(updateFactoryZoneCommand)
registerCommand(deleteFactoryZoneCommand)
