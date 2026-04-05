import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OperationTemplate, OperationDependency } from '../data/entities'
import {
  operationDependencyCreateSchema,
  operationDependencyUpdateSchema,
  type OperationDependencyCreateInput,
  type OperationDependencyUpdateInput,
} from '../data/validators'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

type OperationDependencySnapshot = {
  id: string
  organizationId: string
  tenantId: string
  predecessorOperationId: string
  successorOperationId: string
  dependencyType: string
  linkStrength: string
  overlapQuantity: number | null
  overlapTimeMinutes: string | null
}

type OperationDependencyUndoPayload = UndoPayload<OperationDependencySnapshot>

function extractOperationId(ref: OperationTemplate | unknown): string {
  if (typeof ref === 'object' && ref !== null && 'id' in ref) return (ref as { id: string }).id
  return String(ref)
}

function snapshotDependency(record: OperationDependency): OperationDependencySnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    predecessorOperationId: extractOperationId(record.predecessorOperation),
    successorOperationId: extractOperationId(record.successorOperation),
    dependencyType: record.dependencyType,
    linkStrength: record.linkStrength,
    overlapQuantity: record.overlapQuantity ?? null,
    overlapTimeMinutes: record.overlapTimeMinutes ?? null,
  }
}

async function validateSameRouting(em: EntityManager, predecessorOperationId: string, successorOperationId: string, organizationId: string, tenantId: string): Promise<void> {
  const predOp = await em.findOneOrFail(OperationTemplate, { id: predecessorOperationId, organizationId, tenantId }, { populate: ['routingTemplate'] })
  const succOp = await em.findOneOrFail(OperationTemplate, { id: successorOperationId, organizationId, tenantId }, { populate: ['routingTemplate'] })
  const predRoutingId = typeof predOp.routingTemplate === 'object' && predOp.routingTemplate !== null && 'id' in predOp.routingTemplate ? (predOp.routingTemplate as { id: string }).id : String(predOp.routingTemplate)
  const succRoutingId = typeof succOp.routingTemplate === 'object' && succOp.routingTemplate !== null && 'id' in succOp.routingTemplate ? (succOp.routingTemplate as { id: string }).id : String(succOp.routingTemplate)
  if (predRoutingId !== succRoutingId) {
    throw new CrudHttpError(400, { error: 'Predecessor and successor must belong to the same routing' })
  }
}

const createOperationDependencyCommand: CommandHandler<OperationDependencyCreateInput, { operationDependencyId: string }> = {
  id: 'routing.operation_dependency.create',
  async execute(input, ctx) {
    const parsed = operationDependencyCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    await validateSameRouting(em, parsed.predecessorOperationId, parsed.successorOperationId, parsed.organizationId, parsed.tenantId)

    const predecessorOperation = await em.findOneOrFail(OperationTemplate, { id: parsed.predecessorOperationId, organizationId: parsed.organizationId, tenantId: parsed.tenantId })
    const successorOperation = await em.findOneOrFail(OperationTemplate, { id: parsed.successorOperationId, organizationId: parsed.organizationId, tenantId: parsed.tenantId })

    const record = em.create(OperationDependency, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      predecessorOperation,
      successorOperation,
      dependencyType: parsed.dependencyType ?? 'finish_to_start',
      linkStrength: parsed.linkStrength ?? 'required',
      overlapQuantity: parsed.overlapQuantity ?? null,
      overlapTimeMinutes: parsed.overlapTimeMinutes ?? null,
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

    return { operationDependencyId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationDependency, { id: result.operationDependencyId }, { populate: ['predecessorOperation', 'successorOperation'] })
    return record ? snapshotDependency(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as OperationDependencySnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create operation dependency',
      resourceKind: 'manufacturing.operation_dependency',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OperationDependencyUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationDependency, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateOperationDependencyCommand: CommandHandler<OperationDependencyUpdateInput, { operationDependencyId: string }> = {
  id: 'routing.operation_dependency.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Operation dependency ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(OperationDependency, { id: input.id }, { populate: ['predecessorOperation', 'successorOperation'] })
    return { before: record ? snapshotDependency(record) : null }
  },
  async execute(input, ctx) {
    const parsed = operationDependencyUpdateSchema.parse(input)
    requireId(parsed.id, 'Operation dependency ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationDependency, { id: parsed.id }, { populate: ['predecessorOperation', 'successorOperation'] })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Operation dependency not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'dependencyType', 'linkStrength', 'overlapQuantity', 'overlapTimeMinutes',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { operationDependencyId: record.id }
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

    return { operationDependencyId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationDependency, { id: result.operationDependencyId }, { populate: ['predecessorOperation', 'successorOperation'] })
    return record ? snapshotDependency(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OperationDependencySnapshot | undefined
    const after = snapshots.after as OperationDependencySnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update operation dependency',
      resourceKind: 'manufacturing.operation_dependency',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OperationDependencyUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationDependency, { id: before.id })
    if (!record) return
    Object.assign(record, {
      dependencyType: before.dependencyType,
      linkStrength: before.linkStrength,
      overlapQuantity: before.overlapQuantity,
      overlapTimeMinutes: before.overlapTimeMinutes,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteOperationDependencyCommand: CommandHandler<{ id: string }, { operationDependencyId: string }> = {
  id: 'routing.operation_dependency.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Operation dependency ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(OperationDependency, { id: input.id }, { populate: ['predecessorOperation', 'successorOperation'] })
    return { before: record ? snapshotDependency(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Operation dependency ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationDependency, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Operation dependency not found' })
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

    return { operationDependencyId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OperationDependencySnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete operation dependency',
      resourceKind: 'manufacturing.operation_dependency',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OperationDependencyUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationDependency, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createOperationDependencyCommand)
registerCommand(updateOperationDependencyCommand)
registerCommand(deleteOperationDependencyCommand)
