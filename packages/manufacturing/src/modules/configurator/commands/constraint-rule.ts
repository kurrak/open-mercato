import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ConstraintRule } from '../data/entities'
import {
  constraintRuleCreateSchema,
  constraintRuleUpdateSchema,
  type ConstraintRuleCreateInput,
  type ConstraintRuleUpdateInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const crudEvents: CrudEventsConfig = {
  module: 'configurator',
  entity: 'constraint_rule',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type ConstraintRuleSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  productId: string
  conditionJson: unknown
  actionType: string
  actionData: unknown
  priority: number
  description: string | null
  isActive: boolean
}

type ConstraintRuleUndoPayload = UndoPayload<ConstraintRuleSnapshot>

function snapshotConstraintRule(record: ConstraintRule): ConstraintRuleSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    productId: record.productId,
    conditionJson: record.conditionJson,
    actionType: record.actionType,
    actionData: record.actionData,
    priority: record.priority,
    description: record.description ?? null,
    isActive: record.isActive,
  }
}

const createConstraintRuleCommand: CommandHandler<ConstraintRuleCreateInput, { constraintRuleId: string }> = {
  id: 'configurator.constraint_rule.create',
  async execute(input, ctx) {
    const parsed = constraintRuleCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = em.create(ConstraintRule, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      productId: parsed.productId,
      conditionJson: parsed.conditionJson,
      actionType: parsed.actionType,
      actionData: parsed.actionData,
      priority: parsed.priority ?? 0,
      description: parsed.description ?? null,
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
      events: crudEvents,
    })

    return { constraintRuleId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConstraintRule, { id: result.constraintRuleId })
    return record ? snapshotConstraintRule(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as ConstraintRuleSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create constraint rule',
      resourceKind: 'manufacturing.configurator',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ConstraintRuleUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConstraintRule, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateConstraintRuleCommand: CommandHandler<ConstraintRuleUpdateInput, { constraintRuleId: string }> = {
  id: 'configurator.constraint_rule.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Constraint rule ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(ConstraintRule, { id: input.id })
    return { before: record ? snapshotConstraintRule(record) : null }
  },
  async execute(input, ctx) {
    const parsed = constraintRuleUpdateSchema.parse(input)
    requireId(parsed.id, 'Constraint rule ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConstraintRule, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Constraint rule not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'conditionJson', 'actionType', 'actionData', 'priority', 'description', 'isActive',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { constraintRuleId: record.id }
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
      events: crudEvents,
    })

    return { constraintRuleId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConstraintRule, { id: result.constraintRuleId })
    return record ? snapshotConstraintRule(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ConstraintRuleSnapshot | undefined
    const after = snapshots.after as ConstraintRuleSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update constraint rule',
      resourceKind: 'manufacturing.configurator',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ConstraintRuleUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConstraintRule, { id: before.id })
    if (!record) return
    Object.assign(record, {
      conditionJson: before.conditionJson,
      actionType: before.actionType,
      actionData: before.actionData,
      priority: before.priority,
      description: before.description,
      isActive: before.isActive,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteConstraintRuleCommand: CommandHandler<{ id: string }, { constraintRuleId: string }> = {
  id: 'configurator.constraint_rule.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Constraint rule ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(ConstraintRule, { id: input.id })
    return { before: record ? snapshotConstraintRule(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Constraint rule ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConstraintRule, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Constraint rule not found' })
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
      events: crudEvents,
    })

    return { constraintRuleId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ConstraintRuleSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete constraint rule',
      resourceKind: 'manufacturing.configurator',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ConstraintRuleUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConstraintRule, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createConstraintRuleCommand)
registerCommand(updateConstraintRuleCommand)
registerCommand(deleteConstraintRuleCommand)
