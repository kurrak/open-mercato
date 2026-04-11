import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { ProductManufacturingExtension, UnitOfMeasure } from '../data/entities'
import {
  productMfgExtensionCreateSchema,
  productMfgExtensionUpdateSchema,
  type ProductMfgExtensionCreateInput,
  type ProductMfgExtensionUpdateInput,
} from '../data/validators'

const extensionCrudEvents: CrudEventsConfig = {
  module: 'product_master',
  entity: 'product_manufacturing_extension',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type ExtensionSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  productId: string
  configurationType: string
  procurementType: string
  baseUomId: string | null
  isPhantomDefault: boolean
}

type ExtensionUndoPayload = UndoPayload<ExtensionSnapshot>

function snapshotExtension(record: ProductManufacturingExtension): ExtensionSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    productId: record.productId,
    configurationType: record.configurationType,
    procurementType: record.procurementType,
    baseUomId: (record as unknown as { baseUom?: { id?: string } }).baseUom?.id ?? null,
    isPhantomDefault: record.isPhantomDefault,
  }
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

const createCommand: CommandHandler<ProductMfgExtensionCreateInput, { id: string }> = {
  id: 'product_master.productManufacturingExtension.create',
  async execute(input, ctx) {
    const parsed = productMfgExtensionCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const existing = await em.findOne(ProductManufacturingExtension, {
      productId: parsed.productId,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw new CrudHttpError(409, { error: 'Manufacturing extension already exists for this product' })
    }

    let defaultUom: UnitOfMeasure | null = null
    if (parsed.baseUomId) {
      defaultUom = await em.findOne(UnitOfMeasure, {
        id: parsed.baseUomId,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        deletedAt: null,
      })
    } else {
      defaultUom = await em.findOne(
        UnitOfMeasure,
        {
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
          uomType: 'piece',
          isActive: true,
          deletedAt: null,
        },
        { orderBy: { createdAt: 'asc' } },
      )
      if (!defaultUom) {
        defaultUom = await em.findOne(UnitOfMeasure, {
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
          code: 'szt',
          deletedAt: null,
        })
      }
    }
    if (!defaultUom) {
      throw new CrudHttpError(400, { error: 'No default unit of measure found. Run tenant setup first.' })
    }

    const record = em.create(ProductManufacturingExtension, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      productId: parsed.productId,
      configurationType: parsed.configurationType ?? 'none',
      procurementType: parsed.procurementType ?? 'make',
      isPhantomDefault: parsed.isPhantomDefault ?? false,
      baseUom: defaultUom,
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
      events: extensionCrudEvents,
    })

    return { id: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const { organizationId, tenantId } = requireAuthScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductManufacturingExtension, {
      id: result.id,
      organizationId,
      tenantId,
    })
    return record ? snapshotExtension(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as ExtensionSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Enable manufacturing extension',
      resourceKind: 'manufacturing.product_manufacturing_extension',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ExtensionUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductManufacturingExtension, {
      id: after.id,
      organizationId: after.organizationId,
      tenantId: after.tenantId,
    })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateCommand: CommandHandler<ProductMfgExtensionUpdateInput, { id: string }> = {
  id: 'product_master.productManufacturingExtension.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Manufacturing extension ID is required')
    const { organizationId, tenantId } = requireAuthScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(ProductManufacturingExtension, {
      id: input.id,
      organizationId,
      tenantId,
      deletedAt: null,
    })
    return { before: record ? snapshotExtension(record) : null }
  },
  async execute(input, ctx) {
    const parsed = productMfgExtensionUpdateSchema.parse(input)
    requireId(parsed.id, 'Manufacturing extension ID is required')
    const { organizationId, tenantId } = requireAuthScope(ctx)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductManufacturingExtension, {
      id: parsed.id,
      organizationId,
      tenantId,
      deletedAt: null,
    })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Manufacturing extension not found' })
    }

    const scalarChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'configurationType',
      'procurementType',
      'isPhantomDefault',
    ])
    const filteredScalarChanges = Object.fromEntries(
      Object.entries(scalarChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>
    for (const [key, change] of Object.entries(filteredScalarChanges)) {
      ;(record as unknown as Record<string, unknown>)[key] = change.to
    }

    if (parsed.baseUomId !== undefined) {
      if (parsed.baseUomId) {
        const uom = await em.findOne(UnitOfMeasure, {
          id: parsed.baseUomId,
          organizationId,
          tenantId,
          deletedAt: null,
        })
        if (!uom) {
          throw new CrudHttpError(400, { error: 'Base unit of measure not found' })
        }
        record.baseUom = uom
      }
    }

    if (
      Object.keys(filteredScalarChanges).length === 0 &&
      parsed.baseUomId === undefined
    ) {
      return { id: record.id }
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
      events: extensionCrudEvents,
    })

    return { id: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductManufacturingExtension, { id: result.id })
    return record ? snapshotExtension(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ExtensionSnapshot | undefined
    const after = snapshots.after as ExtensionSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update manufacturing extension',
      resourceKind: 'manufacturing.product_manufacturing_extension',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ExtensionUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductManufacturingExtension, {
      id: before.id,
      organizationId: before.organizationId,
      tenantId: before.tenantId,
    })
    if (!record) return
    record.configurationType = before.configurationType as typeof record.configurationType
    record.procurementType = before.procurementType as typeof record.procurementType
    record.isPhantomDefault = before.isPhantomDefault
    if (before.baseUomId) {
      const uom = await em.findOne(UnitOfMeasure, {
        id: before.baseUomId,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
      })
      if (uom) record.baseUom = uom
    }
    record.updatedAt = new Date()
    await em.flush()
  },
}

const deleteCommand: CommandHandler<{ id: string }, { id: string }> = {
  id: 'product_master.productManufacturingExtension.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Manufacturing extension ID is required')
    const { organizationId, tenantId } = requireAuthScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(ProductManufacturingExtension, {
      id: input.id,
      organizationId,
      tenantId,
      deletedAt: null,
    })
    return { before: record ? snapshotExtension(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Manufacturing extension ID is required')
    const { organizationId, tenantId } = requireAuthScope(ctx)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductManufacturingExtension, {
      id: input.id,
      organizationId,
      tenantId,
      deletedAt: null,
    })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Manufacturing extension not found' })
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
      events: extensionCrudEvents,
    })

    return { id: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ExtensionSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Disable manufacturing extension',
      resourceKind: 'manufacturing.product_manufacturing_extension',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ExtensionUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ProductManufacturingExtension, {
      id: before.id,
      organizationId: before.organizationId,
      tenantId: before.tenantId,
    })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createCommand)
registerCommand(updateCommand)
registerCommand(deleteCommand)
