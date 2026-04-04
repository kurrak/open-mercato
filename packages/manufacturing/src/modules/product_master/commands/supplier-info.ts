import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SupplierInfo } from '../data/entities'
import {
  supplierInfoCreateSchema,
  supplierInfoUpdateSchema,
  type SupplierInfoCreateInput,
  type SupplierInfoUpdateInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const siCrudEvents: CrudEventsConfig = {
  module: 'manufacturing',
  entity: 'supplier_info',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type SiSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  productId: string
  supplierName: string
  supplierId: string | null
  supplierSku: string | null
  price: string | null
  currency: string | null
  minQty: string | null
  orderMultiple: string | null
  leadTimeDays: number | null
  isPreferred: boolean
  validFrom: string | null
  validTo: string | null
  variantId: string | null
  notes: string | null
}

type SiUndoPayload = UndoPayload<SiSnapshot>

function snapshotSi(record: SupplierInfo): SiSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    productId: record.productId,
    supplierName: record.supplierName,
    supplierId: record.supplierId ?? null,
    supplierSku: record.supplierSku ?? null,
    price: record.price ?? null,
    currency: record.currency ?? null,
    minQty: record.minQty ?? null,
    orderMultiple: record.orderMultiple ?? null,
    leadTimeDays: record.leadTimeDays ?? null,
    isPreferred: record.isPreferred,
    validFrom: record.validFrom?.toISOString() ?? null,
    validTo: record.validTo?.toISOString() ?? null,
    variantId: record.variantId ?? null,
    notes: record.notes ?? null,
  }
}

const createSiCommand: CommandHandler<SupplierInfoCreateInput, { supplierInfoId: string }> = {
  id: 'product_master.supplierInfo.create',
  async execute(input, ctx) {
    const parsed = supplierInfoCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = em.create(SupplierInfo, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      productId: parsed.productId,
      supplierName: parsed.supplierName,
      supplierId: parsed.supplierId ?? null,
      supplierSku: parsed.supplierSku ?? null,
      price: parsed.price ?? null,
      currency: parsed.currency ?? null,
      minQty: parsed.minQty ?? null,
      orderMultiple: parsed.orderMultiple ?? null,
      leadTimeDays: parsed.leadTimeDays ?? null,
      isPreferred: parsed.isPreferred ?? false,
      validFrom: parsed.validFrom ?? null,
      validTo: parsed.validTo ?? null,
      variantId: parsed.variantId ?? null,
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
      events: siCrudEvents,
    })

    return { supplierInfoId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(SupplierInfo, { id: result.supplierInfoId })
    return record ? snapshotSi(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as SiSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create supplier info',
      resourceKind: 'manufacturing.supplier_info',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<SiUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(SupplierInfo, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateSiCommand: CommandHandler<SupplierInfoUpdateInput, { supplierInfoId: string }> = {
  id: 'product_master.supplierInfo.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Supplier info ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(SupplierInfo, { id: input.id })
    return { before: record ? snapshotSi(record) : null }
  },
  async execute(input, ctx) {
    const parsed = supplierInfoUpdateSchema.parse(input)
    requireId(parsed.id, 'Supplier info ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(SupplierInfo, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Supplier info not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'supplierName', 'supplierId', 'supplierSku', 'price', 'currency',
      'minQty', 'orderMultiple', 'leadTimeDays', 'isPreferred',
      'validFrom', 'validTo', 'variantId', 'notes',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { supplierInfoId: record.id }
    }

    for (const [key, change] of Object.entries(changes)) {
      ;(record as Record<string, unknown>)[key] = change.to
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
      events: siCrudEvents,
    })

    return { supplierInfoId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(SupplierInfo, { id: result.supplierInfoId })
    return record ? snapshotSi(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as SiSnapshot | undefined
    const after = snapshots.after as SiSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update supplier info',
      resourceKind: 'manufacturing.supplier_info',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<SiUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(SupplierInfo, { id: before.id })
    if (!record) return
    Object.assign(record, {
      supplierName: before.supplierName,
      supplierId: before.supplierId,
      supplierSku: before.supplierSku,
      price: before.price,
      currency: before.currency,
      minQty: before.minQty,
      orderMultiple: before.orderMultiple,
      leadTimeDays: before.leadTimeDays,
      isPreferred: before.isPreferred,
      validFrom: before.validFrom ? new Date(before.validFrom) : null,
      validTo: before.validTo ? new Date(before.validTo) : null,
      variantId: before.variantId,
      notes: before.notes,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteSiCommand: CommandHandler<{ id: string }, { supplierInfoId: string }> = {
  id: 'product_master.supplierInfo.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Supplier info ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(SupplierInfo, { id: input.id })
    return { before: record ? snapshotSi(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Supplier info ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(SupplierInfo, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Supplier info not found' })
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
      events: siCrudEvents,
    })

    return { supplierInfoId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as SiSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete supplier info',
      resourceKind: 'manufacturing.supplier_info',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<SiUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(SupplierInfo, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand('product_master.supplierInfo.create', createSiCommand)
registerCommand('product_master.supplierInfo.update', updateSiCommand)
registerCommand('product_master.supplierInfo.delete', deleteSiCommand)
