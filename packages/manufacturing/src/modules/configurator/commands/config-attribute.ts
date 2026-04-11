import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ConfigAttribute } from '../data/entities'
import {
  configAttributeCreateSchema,
  configAttributeUpdateSchema,
  type ConfigAttributeCreateInput,
  type ConfigAttributeUpdateInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const crudEvents: CrudEventsConfig = {
  module: 'configurator',
  entity: 'config_attribute',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type ConfigAttributeSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  productId: string
  key: string
  label: string
  attributeType: string
  allowedValues: unknown | null
  materialFilterId: string | null
  isMandatory: boolean
  displayOrder: number
  defaultValue: string | null
  attributeGroup: string | null
  isActive: boolean
}

type ConfigAttributeUndoPayload = UndoPayload<ConfigAttributeSnapshot>

function snapshotConfigAttribute(record: ConfigAttribute): ConfigAttributeSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    productId: record.productId,
    key: record.key,
    label: record.label,
    attributeType: record.attributeType,
    allowedValues: record.allowedValues ?? null,
    materialFilterId: record.materialFilterId ?? null,
    isMandatory: record.isMandatory,
    displayOrder: record.displayOrder,
    defaultValue: record.defaultValue ?? null,
    attributeGroup: record.attributeGroup ?? null,
    isActive: record.isActive,
  }
}

const createConfigAttributeCommand: CommandHandler<ConfigAttributeCreateInput, { configAttributeId: string }> = {
  id: 'configurator.config_attribute.create',
  async execute(input, ctx) {
    const parsed = configAttributeCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const record = em.create(ConfigAttribute, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      productId: parsed.productId,
      key: parsed.key,
      label: parsed.label,
      attributeType: parsed.attributeType ?? 'enum',
      allowedValues: parsed.allowedValues ?? null,
      materialFilterId: parsed.materialFilterId ?? null,
      isMandatory: parsed.isMandatory ?? true,
      displayOrder: parsed.displayOrder ?? 0,
      defaultValue: parsed.defaultValue ?? null,
      attributeGroup: parsed.attributeGroup ?? null,
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

    return { configAttributeId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConfigAttribute, { id: result.configAttributeId })
    return record ? snapshotConfigAttribute(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as ConfigAttributeSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Create config attribute',
      resourceKind: 'manufacturing.configurator',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ConfigAttributeUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConfigAttribute, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateConfigAttributeCommand: CommandHandler<ConfigAttributeUpdateInput, { configAttributeId: string }> = {
  id: 'configurator.config_attribute.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Config attribute ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(ConfigAttribute, { id: input.id })
    return { before: record ? snapshotConfigAttribute(record) : null }
  },
  async execute(input, ctx) {
    const parsed = configAttributeUpdateSchema.parse(input)
    requireId(parsed.id, 'Config attribute ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConfigAttribute, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Config attribute not found' })
    }

    const allChanges = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'key', 'label', 'attributeType', 'allowedValues', 'materialFilterId',
      'isMandatory', 'displayOrder', 'defaultValue', 'attributeGroup', 'isActive',
    ])
    const changes = Object.fromEntries(
      Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
    ) as Record<string, { from: unknown; to: unknown }>

    if (Object.keys(changes).length === 0) {
      return { configAttributeId: record.id }
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

    return { configAttributeId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConfigAttribute, { id: result.configAttributeId })
    return record ? snapshotConfigAttribute(record) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ConfigAttributeSnapshot | undefined
    const after = snapshots.after as ConfigAttributeSnapshot | undefined
    if (!after) return null
    return {
      actionLabel: 'Update config attribute',
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
    const payload = extractUndoPayload<ConfigAttributeUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConfigAttribute, { id: before.id })
    if (!record) return
    Object.assign(record, {
      key: before.key,
      label: before.label,
      attributeType: before.attributeType,
      allowedValues: before.allowedValues,
      materialFilterId: before.materialFilterId,
      isMandatory: before.isMandatory,
      displayOrder: before.displayOrder,
      defaultValue: before.defaultValue,
      attributeGroup: before.attributeGroup,
      isActive: before.isActive,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteConfigAttributeCommand: CommandHandler<{ id: string }, { configAttributeId: string }> = {
  id: 'configurator.config_attribute.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Config attribute ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const record = await em.findOne(ConfigAttribute, { id: input.id })
    return { before: record ? snapshotConfigAttribute(record) : null }
  },
  async execute(input, ctx) {
    requireId(input.id, 'Config attribute ID is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConfigAttribute, { id: input.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Config attribute not found' })
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

    return { configAttributeId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ConfigAttributeSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete config attribute',
      resourceKind: 'manufacturing.configurator',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ConfigAttributeUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ConfigAttribute, { id: before.id })
    if (!record) return
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createConfigAttributeCommand)
registerCommand(updateConfigAttributeCommand)
registerCommand(deleteConfigAttributeCommand)
