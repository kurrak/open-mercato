import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { WorkCenter, FactoryZone } from '../data/entities'
import {
  workCenterCreateSchema,
  workCenterUpdateSchema,
  type WorkCenterCreateInput,
  type WorkCenterUpdateInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const workCenterCrudEvents: CrudEventsConfig = {
  module: 'routing',
  entity: 'work_center',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type WorkCenterSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string
  factoryZoneId: string | null
  capacity: number
  efficiencyPercent: number
  schedulingMode: string
  shiftCalendarId: string | null
  defaultHourlyRate: string | null
  overheadRatePerHour: string | null
  isActive: boolean
  notes: string | null
}

type WorkCenterUndoPayload = UndoPayload<WorkCenterSnapshot>

function extractManyToOneId(ref: unknown): string | null {
  if (ref == null) return null
  if (typeof ref === 'object' && ref !== null && 'id' in ref) return (ref as { id: string }).id
  return String(ref)
}

function snapshotWorkCenter(record: WorkCenter): WorkCenterSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code,
    factoryZoneId: extractManyToOneId(record.factoryZone),
    capacity: record.capacity,
    efficiencyPercent: record.efficiencyPercent,
    schedulingMode: record.schedulingMode,
    shiftCalendarId: record.shiftCalendarId ?? null,
    defaultHourlyRate: record.defaultHourlyRate ?? null,
    overheadRatePerHour: record.overheadRatePerHour ?? null,
    isActive: record.isActive,
    notes: record.notes ?? null,
  }
}

const createWorkCenterCommand: CommandHandler<WorkCenterCreateInput, { workCenterId: string }> = {
  id: 'routing.work_center.create',
  async execute(input, ctx) {
    const parsed = workCenterCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    let factoryZoneRef: FactoryZone | null = null
    if (parsed.factoryZoneId) {
      factoryZoneRef = await em.findOne(FactoryZone, { id: parsed.factoryZoneId })
      if (!factoryZoneRef) {
        throw new CrudHttpError(404, { error: 'Factory zone not found' })
      }
    }

    const record = em.create(WorkCenter, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      code: parsed.code,
      factoryZone: factoryZoneRef,
      capacity: parsed.capacity ?? 1,
      efficiencyPercent: parsed.efficiencyPercent ?? 100,
      schedulingMode: parsed.schedulingMode ?? 'infinite',
      shiftCalendarId: parsed.shiftCalendarId ?? null,
      defaultHourlyRate: parsed.defaultHourlyRate ?? null,
      overheadRatePerHour: parsed.overheadRatePerHour ?? null,
      isActive: parsed.isActive ?? true,
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
      events: workCenterCrudEvents,
    })

    return { workCenterId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(WorkCenter, { id: result.workCenterId })
    return record ? snapshotWorkCenter(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as WorkCenterSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create work center',
      resourceKind: 'manufacturing.work_center',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WorkCenterUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(WorkCenter, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateWorkCenterCommand: CommandHandler<WorkCenterUpdateInput, { workCenterId: string }> = {
  id: 'routing.work_center.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Work center ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(WorkCenter, { id: input.id })
    return { before: record ? snapshotWorkCenter(record) : null }
  },
  async execute(input, ctx) {
    const parsed = workCenterUpdateSchema.parse(input)
    requireId(parsed.id, 'Work center ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(WorkCenter, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Work center not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'name', 'code', 'capacity', 'efficiencyPercent', 'schedulingMode',
      'shiftCalendarId', 'defaultHourlyRate', 'overheadRatePerHour', 'isActive', 'notes',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    // Handle factoryZone ManyToOne separately
    let factoryZoneChanged = false
    if (parsed.factoryZoneId !== undefined) {
      const currentZoneId = extractManyToOneId(record.factoryZone)
      if (currentZoneId !== (parsed.factoryZoneId ?? null)) {
        factoryZoneChanged = true
        if (parsed.factoryZoneId) {
          const zoneRef = await em.findOne(FactoryZone, { id: parsed.factoryZoneId })
          if (!zoneRef) {
            throw new CrudHttpError(404, { error: 'Factory zone not found' })
          }
          record.factoryZone = zoneRef
        } else {
          record.factoryZone = null
        }
      }
    }

    if (Object.keys(changes).length === 0 && !factoryZoneChanged) {
      return { workCenterId: record.id }
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
      events: workCenterCrudEvents,
    })

    return { workCenterId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(WorkCenter, { id: result.workCenterId })
    return record ? snapshotWorkCenter(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as WorkCenterSnapshot | undefined
    const after = snapshots.after as WorkCenterSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update work center',
      resourceKind: 'manufacturing.work_center',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WorkCenterUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(WorkCenter, { id: before.id })
    if (!record) return
    if (before.factoryZoneId) {
      const zoneRef = await em.findOne(FactoryZone, { id: before.factoryZoneId })
      record.factoryZone = zoneRef ?? null
    } else {
      record.factoryZone = null
    }
    Object.assign(record, {
      name: before.name,
      code: before.code,
      capacity: before.capacity,
      efficiencyPercent: before.efficiencyPercent,
      schedulingMode: before.schedulingMode,
      shiftCalendarId: before.shiftCalendarId,
      defaultHourlyRate: before.defaultHourlyRate,
      overheadRatePerHour: before.overheadRatePerHour,
      isActive: before.isActive,
      notes: before.notes,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteWorkCenterCommand: CommandHandler<{ id: string }, { workCenterId: string }> = {
  id: 'routing.work_center.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Work center ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(WorkCenter, { id: input.id })
    return { before: record ? snapshotWorkCenter(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Work center ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(WorkCenter, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Work center not found' })
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
      events: workCenterCrudEvents,
    })

    return { workCenterId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as WorkCenterSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete work center',
      resourceKind: 'manufacturing.work_center',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WorkCenterUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(WorkCenter, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createWorkCenterCommand)
registerCommand(updateWorkCenterCommand)
registerCommand(deleteWorkCenterCommand)
