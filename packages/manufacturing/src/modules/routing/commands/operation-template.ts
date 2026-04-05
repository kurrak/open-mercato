import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { RoutingTemplate, OperationTemplate, WorkCenter } from '../data/entities'
import {
  operationTemplateCreateSchema,
  operationTemplateUpdateSchema,
  type OperationTemplateCreateInput,
  type OperationTemplateUpdateInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const operationTemplateCrudEvents: CrudEventsConfig = {
  module: 'manufacturing',
  entity: 'operation',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type OperationTemplateSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  routingTemplateId: string
  workCenterId: string | null
  sequence: number
  name: string
  setupTimeMinutes: string | null
  runTimeMinutes: string | null
  teardownTimeMinutes: string | null
  queueTimeMinutes: string | null
  waitTimeMinutes: string | null
  moveTimeMinutes: string | null
  paymentType: string
  pieceworkRate: string | null
  hourlyRate: string | null
  isSubcontracted: boolean
  allowSplitting: boolean
  maxSplits: number | null
  setupGroup: string | null
  instructions: string | null
  notes: string | null
}

type OperationTemplateUndoPayload = UndoPayload<OperationTemplateSnapshot>

function extractRoutingTemplateId(record: OperationTemplate): string {
  const ref = record.routingTemplate
  if (typeof ref === 'object' && ref !== null && 'id' in ref) return (ref as { id: string }).id
  return String(ref)
}

function extractWorkCenterId(record: OperationTemplate): string | null {
  const ref = record.workCenter
  if (ref == null) return null
  if (typeof ref === 'object' && ref !== null && 'id' in ref) return (ref as { id: string }).id
  return String(ref)
}

function snapshotOperationTemplate(record: OperationTemplate): OperationTemplateSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    routingTemplateId: extractRoutingTemplateId(record),
    workCenterId: extractWorkCenterId(record),
    sequence: record.sequence,
    name: record.name,
    setupTimeMinutes: record.setupTimeMinutes ?? null,
    runTimeMinutes: record.runTimeMinutes ?? null,
    teardownTimeMinutes: record.teardownTimeMinutes ?? null,
    queueTimeMinutes: record.queueTimeMinutes ?? null,
    waitTimeMinutes: record.waitTimeMinutes ?? null,
    moveTimeMinutes: record.moveTimeMinutes ?? null,
    paymentType: record.paymentType,
    pieceworkRate: record.pieceworkRate ?? null,
    hourlyRate: record.hourlyRate ?? null,
    isSubcontracted: record.isSubcontracted,
    allowSplitting: record.allowSplitting,
    maxSplits: record.maxSplits ?? null,
    setupGroup: record.setupGroup ?? null,
    instructions: record.instructions ?? null,
    notes: record.notes ?? null,
  }
}

const createOperationTemplateCommand: CommandHandler<OperationTemplateCreateInput, { operationTemplateId: string }> = {
  id: 'routing.operation_template.create',
  async execute(input, ctx) {
    const parsed = operationTemplateCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const routingTemplate = await em.findOneOrFail(RoutingTemplate, { id: parsed.routingTemplateId })

    let workCenter: WorkCenter | null = null
    if (parsed.workCenterId) {
      workCenter = await em.findOneOrFail(WorkCenter, { id: parsed.workCenterId })
    }

    const record = em.create(OperationTemplate, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      routingTemplate,
      workCenter: workCenter ?? null,
      sequence: parsed.sequence ?? 10,
      name: parsed.name,
      setupTimeMinutes: parsed.setupTimeMinutes ?? null,
      runTimeMinutes: parsed.runTimeMinutes ?? null,
      teardownTimeMinutes: parsed.teardownTimeMinutes ?? null,
      queueTimeMinutes: parsed.queueTimeMinutes ?? null,
      waitTimeMinutes: parsed.waitTimeMinutes ?? null,
      moveTimeMinutes: parsed.moveTimeMinutes ?? null,
      paymentType: parsed.paymentType ?? 'hourly',
      pieceworkRate: parsed.pieceworkRate ?? null,
      hourlyRate: parsed.hourlyRate ?? null,
      isSubcontracted: parsed.isSubcontracted ?? false,
      allowSplitting: parsed.allowSplitting ?? false,
      maxSplits: parsed.maxSplits ?? null,
      setupGroup: parsed.setupGroup ?? null,
      instructions: parsed.instructions ?? null,
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
      events: operationTemplateCrudEvents,
    })

    return { operationTemplateId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplate, { id: result.operationTemplateId }, { populate: ['routingTemplate', 'workCenter'] })
    return record ? snapshotOperationTemplate(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as OperationTemplateSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create operation template',
      resourceKind: 'manufacturing.operation_template',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OperationTemplateUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplate, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateOperationTemplateCommand: CommandHandler<OperationTemplateUpdateInput, { operationTemplateId: string }> = {
  id: 'routing.operation_template.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Operation template ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(OperationTemplate, { id: input.id }, { populate: ['routingTemplate', 'workCenter'] })
    return { before: record ? snapshotOperationTemplate(record) : null }
  },
  async execute(input, ctx) {
    const parsed = operationTemplateUpdateSchema.parse(input)
    requireId(parsed.id, 'Operation template ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplate, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Operation template not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'workCenterId', 'sequence', 'name', 'setupTimeMinutes', 'runTimeMinutes',
      'teardownTimeMinutes', 'queueTimeMinutes', 'waitTimeMinutes', 'moveTimeMinutes',
      'paymentType', 'pieceworkRate', 'hourlyRate', 'isSubcontracted', 'allowSplitting',
      'maxSplits', 'setupGroup', 'instructions', 'notes',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { operationTemplateId: record.id }
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
      events: operationTemplateCrudEvents,
    })

    return { operationTemplateId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplate, { id: result.operationTemplateId }, { populate: ['routingTemplate', 'workCenter'] })
    return record ? snapshotOperationTemplate(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OperationTemplateSnapshot | undefined
    const after = snapshots.after as OperationTemplateSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update operation template',
      resourceKind: 'manufacturing.operation_template',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OperationTemplateUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplate, { id: before.id })
    if (!record) return
    Object.assign(record, {
      workCenterId: before.workCenterId,
      sequence: before.sequence,
      name: before.name,
      setupTimeMinutes: before.setupTimeMinutes,
      runTimeMinutes: before.runTimeMinutes,
      teardownTimeMinutes: before.teardownTimeMinutes,
      queueTimeMinutes: before.queueTimeMinutes,
      waitTimeMinutes: before.waitTimeMinutes,
      moveTimeMinutes: before.moveTimeMinutes,
      paymentType: before.paymentType,
      pieceworkRate: before.pieceworkRate,
      hourlyRate: before.hourlyRate,
      isSubcontracted: before.isSubcontracted,
      allowSplitting: before.allowSplitting,
      maxSplits: before.maxSplits,
      setupGroup: before.setupGroup,
      instructions: before.instructions,
      notes: before.notes,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteOperationTemplateCommand: CommandHandler<{ id: string }, { operationTemplateId: string }> = {
  id: 'routing.operation_template.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Operation template ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(OperationTemplate, { id: input.id }, { populate: ['routingTemplate', 'workCenter'] })
    return { before: record ? snapshotOperationTemplate(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Operation template ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplate, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Operation template not found' })
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
      events: operationTemplateCrudEvents,
    })

    return { operationTemplateId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OperationTemplateSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete operation template',
      resourceKind: 'manufacturing.operation_template',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OperationTemplateUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplate, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createOperationTemplateCommand)
registerCommand(updateOperationTemplateCommand)
registerCommand(deleteOperationTemplateCommand)
