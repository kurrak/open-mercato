import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ProductionMethod, ProductManufacturingExtension, UnitOfMeasure } from '../data/entities'
import {
  productionMethodCreateSchema,
  productionMethodUpdateSchema,
  type ProductionMethodCreateInput,
  type ProductionMethodUpdateInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const pmCrudEvents: CrudEventsConfig = {
  module: 'product_master',
  entity: 'production_method',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type PMSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  productId: string
  name: string
  bomHeaderId: string | null
  routingTemplateId: string | null
  isDefault: boolean
  variantCondition: Record<string, unknown> | null
  version: number
  validFrom: string | null
  validTo: string | null
  lifecycleState: string
}

type PMUndoPayload = UndoPayload<PMSnapshot>

function snapshotPM(record: ProductionMethod): PMSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    productId: record.productId,
    name: record.name,
    bomHeaderId: record.bomHeaderId ?? null,
    routingTemplateId: record.routingTemplateId ?? null,
    isDefault: record.isDefault,
    variantCondition: record.variantCondition ?? null,
    version: record.version,
    validFrom: record.validFrom?.toISOString() ?? null,
    validTo: record.validTo?.toISOString() ?? null,
    lifecycleState: record.lifecycleState,
  }
}

async function ensureManufacturingExtension(
  em: EntityManager,
  productId: string,
  organizationId: string,
  tenantId: string,
): Promise<void> {
  const existing = await em.findOne(ProductManufacturingExtension, {
    productId,
    organizationId,
    tenantId,
    deletedAt: null,
  })
  if (existing) return

  const defaultUom = await em.findOne(UnitOfMeasure, {
    organizationId,
    tenantId,
    code: 'szt',
    deletedAt: null,
  })
  if (!defaultUom) {
    throw new CrudHttpError(400, {
      error: 'No default unit of measure found. Run tenant setup first.',
    })
  }

  em.create(ProductManufacturingExtension, {
    organizationId,
    tenantId,
    productId,
    configurationType: 'none',
    procurementType: 'make',
    baseUom: defaultUom,
  })
}

function requireAuthScope(ctx: { auth: { orgId?: string | null; tenantId?: string | null } | null }): {
  organizationId: string
  tenantId: string
} {
  const organizationId = ctx.auth?.orgId
  const tenantId = ctx.auth?.tenantId
  if (!organizationId || !tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  return { organizationId, tenantId }
}

async function demoteOtherDefaults(
  em: EntityManager,
  params: {
    organizationId: string
    tenantId: string
    productId: string
    excludeId: string | null
  },
): Promise<void> {
  const others = await em.find(ProductionMethod, {
    organizationId: params.organizationId,
    tenantId: params.tenantId,
    productId: params.productId,
    isDefault: true,
    deletedAt: null,
    ...(params.excludeId ? { id: { $ne: params.excludeId } } : {}),
  })
  for (const other of others) {
    other.isDefault = false
    other.updatedAt = new Date()
  }
}

const createPMCommand: CommandHandler<ProductionMethodCreateInput, { productionMethodId: string }> = {
  id: 'product_master.productionMethod.create',
  async execute(input, ctx) {
    const parsed = productionMethodCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    await ensureManufacturingExtension(em, parsed.productId, parsed.organizationId, parsed.tenantId)

    if (parsed.isDefault) {
      await demoteOtherDefaults(em, {
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        productId: parsed.productId,
        excludeId: null,
      })
    }

    const record = em.create(ProductionMethod, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      productId: parsed.productId,
      name: parsed.name,
      bomHeaderId: parsed.bomHeaderId ?? null,
      routingTemplateId: parsed.routingTemplateId ?? null,
      isDefault: parsed.isDefault ?? false,
      variantCondition: parsed.variantCondition ?? null,
      version: parsed.version ?? 1,
      validFrom: parsed.validFrom ?? null,
      validTo: parsed.validTo ?? null,
      lifecycleState: parsed.lifecycleState ?? 'draft',
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
      events: pmCrudEvents,
    })

    return { productionMethodId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const { organizationId, tenantId } = requireAuthScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductionMethod, {
      id: result.productionMethodId,
      organizationId,
      tenantId,
    })
    return record ? snapshotPM(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as PMSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create production method',
      resourceKind: 'manufacturing.production_method',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PMUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductionMethod, {
      id: after.id,
      organizationId: after.organizationId,
      tenantId: after.tenantId,
    })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updatePMCommand: CommandHandler<ProductionMethodUpdateInput, { productionMethodId: string }> = {
  id: 'product_master.productionMethod.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Production method ID is required')
    const { organizationId, tenantId } = requireAuthScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(ProductionMethod, {
      id: input.id,
      organizationId,
      tenantId,
      deletedAt: null,
    })
    return { before: record ? snapshotPM(record) : null }
  },
  async execute(input, ctx) {
    const parsed = productionMethodUpdateSchema.parse(input)
    requireId(parsed.id, 'Production method ID is required')
    const { organizationId, tenantId } = requireAuthScope(ctx)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductionMethod, {
      id: parsed.id,
      organizationId,
      tenantId,
      deletedAt: null,
    })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Production method not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'name', 'bomHeaderId', 'routingTemplateId', 'isDefault',
      'variantCondition', 'version', 'validFrom', 'validTo', 'lifecycleState',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { productionMethodId: record.id }
    }

    if (changes.isDefault?.to === true) {
      await demoteOtherDefaults(em, {
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        productId: record.productId,
        excludeId: record.id,
      })
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
      events: pmCrudEvents,
    })

    return { productionMethodId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const { organizationId, tenantId } = requireAuthScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductionMethod, {
      id: result.productionMethodId,
      organizationId,
      tenantId,
    })
    return record ? snapshotPM(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PMSnapshot | undefined
    const after = snapshots.after as PMSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update production method',
      resourceKind: 'manufacturing.production_method',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PMUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductionMethod, {
      id: before.id,
      organizationId: before.organizationId,
      tenantId: before.tenantId,
    })
    if (!record) return
    Object.assign(record, {
      name: before.name,
      bomHeaderId: before.bomHeaderId,
      routingTemplateId: before.routingTemplateId,
      isDefault: before.isDefault,
      variantCondition: before.variantCondition,
      version: before.version,
      validFrom: before.validFrom ? new Date(before.validFrom) : null,
      validTo: before.validTo ? new Date(before.validTo) : null,
      lifecycleState: before.lifecycleState,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deletePMCommand: CommandHandler<{ id: string }, { productionMethodId: string }> = {
  id: 'product_master.productionMethod.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Production method ID is required')
    const { organizationId, tenantId } = requireAuthScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(ProductionMethod, {
      id: input.id,
      organizationId,
      tenantId,
      deletedAt: null,
    })
    return { before: record ? snapshotPM(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Production method ID is required')
    const { organizationId, tenantId } = requireAuthScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductionMethod, {
      id: input.id,
      organizationId,
      tenantId,
      deletedAt: null,
    })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Production method not found' })
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
      events: pmCrudEvents,
    })

    return { productionMethodId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PMSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete production method',
      resourceKind: 'manufacturing.production_method',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PMUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductionMethod, {
      id: before.id,
      organizationId: before.organizationId,
      tenantId: before.tenantId,
    })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createPMCommand)
registerCommand(updatePMCommand)
registerCommand(deletePMCommand)
