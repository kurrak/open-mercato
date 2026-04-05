import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OperationTemplate, OperationTemplateVariant } from '../data/entities'
import {
  operationTemplateVariantCreateSchema,
  operationTemplateVariantUpdateSchema,
  type OperationTemplateVariantCreateInput,
  type OperationTemplateVariantUpdateInput,
} from '../data/validators'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

type OTVSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  operationTemplateId: string
  variantId: string | null
  variantCondition: Record<string, unknown> | null
  runTimeOverride: string | null
  setupTimeOverride: string | null
  teardownTimeOverride: string | null
  workCenterOverrideId: string | null
  pieceworkRateOverride: string | null
  hourlyRateOverride: string | null
  notes: string | null
}

type OTVUndoPayload = UndoPayload<OTVSnapshot>

function snapshotOTV(record: OperationTemplateVariant): OTVSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    operationTemplateId: typeof record.operationTemplate === 'object' && record.operationTemplate !== null && 'id' in record.operationTemplate ? (record.operationTemplate as { id: string }).id : String(record.operationTemplate),
    variantId: record.variantId ?? null,
    variantCondition: record.variantCondition ?? null,
    runTimeOverride: record.runTimeOverride ?? null,
    setupTimeOverride: record.setupTimeOverride ?? null,
    teardownTimeOverride: record.teardownTimeOverride ?? null,
    workCenterOverrideId: record.workCenterOverrideId ?? null,
    pieceworkRateOverride: record.pieceworkRateOverride ?? null,
    hourlyRateOverride: record.hourlyRateOverride ?? null,
    notes: record.notes ?? null,
  }
}

const createOTVCommand: CommandHandler<OperationTemplateVariantCreateInput, { operationTemplateVariantId: string }> = {
  id: 'routing.operation_template_variant.create',
  async execute(input, ctx) {
    const parsed = operationTemplateVariantCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const operationTemplate = await em.findOneOrFail(OperationTemplate, { id: parsed.operationTemplateId })

    const record = em.create(OperationTemplateVariant, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      operationTemplate,
      variantId: parsed.variantId ?? null,
      variantCondition: parsed.variantCondition ?? null,
      runTimeOverride: parsed.runTimeOverride ?? null,
      setupTimeOverride: parsed.setupTimeOverride ?? null,
      teardownTimeOverride: parsed.teardownTimeOverride ?? null,
      workCenterOverrideId: parsed.workCenterOverrideId ?? null,
      pieceworkRateOverride: parsed.pieceworkRateOverride ?? null,
      hourlyRateOverride: parsed.hourlyRateOverride ?? null,
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

    return { operationTemplateVariantId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplateVariant, { id: result.operationTemplateVariantId }, { populate: ['operationTemplate'] })
    return record ? snapshotOTV(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as OTVSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create operation template variant',
      resourceKind: 'manufacturing.operation_template_variant',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OTVUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplateVariant, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateOTVCommand: CommandHandler<OperationTemplateVariantUpdateInput, { operationTemplateVariantId: string }> = {
  id: 'routing.operation_template_variant.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Operation template variant ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(OperationTemplateVariant, { id: input.id }, { populate: ['operationTemplate'] })
    return { before: record ? snapshotOTV(record) : null }
  },
  async execute(input, ctx) {
    const parsed = operationTemplateVariantUpdateSchema.parse(input)
    requireId(parsed.id, 'Operation template variant ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplateVariant, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Operation template variant not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'variantId', 'variantCondition', 'runTimeOverride', 'setupTimeOverride',
      'teardownTimeOverride', 'workCenterOverrideId', 'pieceworkRateOverride',
      'hourlyRateOverride', 'notes',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { operationTemplateVariantId: record.id }
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

    return { operationTemplateVariantId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplateVariant, { id: result.operationTemplateVariantId }, { populate: ['operationTemplate'] })
    return record ? snapshotOTV(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OTVSnapshot | undefined
    const after = snapshots.after as OTVSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update operation template variant',
      resourceKind: 'manufacturing.operation_template_variant',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OTVUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplateVariant, { id: before.id })
    if (!record) return
    Object.assign(record, {
      variantId: before.variantId,
      variantCondition: before.variantCondition,
      runTimeOverride: before.runTimeOverride,
      setupTimeOverride: before.setupTimeOverride,
      teardownTimeOverride: before.teardownTimeOverride,
      workCenterOverrideId: before.workCenterOverrideId,
      pieceworkRateOverride: before.pieceworkRateOverride,
      hourlyRateOverride: before.hourlyRateOverride,
      notes: before.notes,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteOTVCommand: CommandHandler<{ id: string }, { operationTemplateVariantId: string }> = {
  id: 'routing.operation_template_variant.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Operation template variant ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(OperationTemplateVariant, { id: input.id }, { populate: ['operationTemplate'] })
    return { before: record ? snapshotOTV(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Operation template variant ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplateVariant, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Operation template variant not found' })
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

    return { operationTemplateVariantId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OTVSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete operation template variant',
      resourceKind: 'manufacturing.operation_template_variant',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OTVUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(OperationTemplateVariant, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createOTVCommand)
registerCommand(updateOTVCommand)
registerCommand(deleteOTVCommand)
