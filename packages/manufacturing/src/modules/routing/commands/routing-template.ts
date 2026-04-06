import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { RoutingTemplate } from '../data/entities'
import {
  routingTemplateCreateSchema,
  routingTemplateUpdateSchema,
  type RoutingTemplateCreateInput,
  type RoutingTemplateUpdateInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const routingCrudEvents: CrudEventsConfig = {
  module: 'routing',
  entity: 'routing_template',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type RoutingTemplateSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  productId: string
  name: string
  isActive: boolean
  version: number
  notes: string | null
}

type RoutingTemplateUndoPayload = UndoPayload<RoutingTemplateSnapshot>

function snapshotRoutingTemplate(record: RoutingTemplate): RoutingTemplateSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    productId: record.productId,
    name: record.name,
    isActive: record.isActive,
    version: record.version,
    notes: record.notes ?? null,
  }
}

const createRoutingTemplateCommand: CommandHandler<RoutingTemplateCreateInput, { routingTemplateId: string }> = {
  id: 'routing.routing_template.create',
  async execute(input, ctx) {
    const parsed = routingTemplateCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = em.create(RoutingTemplate, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      productId: parsed.productId,
      name: parsed.name,
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
      events: routingCrudEvents,
    })

    return { routingTemplateId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(RoutingTemplate, { id: result.routingTemplateId })
    return record ? snapshotRoutingTemplate(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as RoutingTemplateSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create routing template',
      resourceKind: 'manufacturing.routing',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<RoutingTemplateUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(RoutingTemplate, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateRoutingTemplateCommand: CommandHandler<RoutingTemplateUpdateInput, { routingTemplateId: string }> = {
  id: 'routing.routing_template.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Routing template ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(RoutingTemplate, { id: input.id })
    return { before: record ? snapshotRoutingTemplate(record) : null }
  },
  async execute(input, ctx) {
    const parsed = routingTemplateUpdateSchema.parse(input)
    requireId(parsed.id, 'Routing template ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(RoutingTemplate, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Routing template not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'name', 'isActive', 'version', 'notes',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { routingTemplateId: record.id }
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
      events: routingCrudEvents,
    })

    return { routingTemplateId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(RoutingTemplate, { id: result.routingTemplateId })
    return record ? snapshotRoutingTemplate(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as RoutingTemplateSnapshot | undefined
    const after = snapshots.after as RoutingTemplateSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update routing template',
      resourceKind: 'manufacturing.routing',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<RoutingTemplateUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(RoutingTemplate, { id: before.id })
    if (!record) return
    Object.assign(record, {
      name: before.name,
      isActive: before.isActive,
      version: before.version,
      notes: before.notes,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteRoutingTemplateCommand: CommandHandler<{ id: string }, { routingTemplateId: string }> = {
  id: 'routing.routing_template.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Routing template ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(RoutingTemplate, { id: input.id })
    return { before: record ? snapshotRoutingTemplate(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Routing template ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(RoutingTemplate, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Routing template not found' })
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
      events: routingCrudEvents,
    })

    return { routingTemplateId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as RoutingTemplateSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete routing template',
      resourceKind: 'manufacturing.routing',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<RoutingTemplateUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(RoutingTemplate, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createRoutingTemplateCommand)
registerCommand(updateRoutingTemplateCommand)
registerCommand(deleteRoutingTemplateCommand)
