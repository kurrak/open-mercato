import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { ConfigAttribute } from '../../../data/entities'
import { configAttributeCreateSchema, configAttributeUpdateSchema } from '../../../data/validators'
import { createConfiguratorCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['configurator.view'] },
  POST: { requireAuth: true, requireFeatures: ['configurator.edit'] },
  PUT: { requireAuth: true, requireFeatures: ['configurator.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['configurator.edit'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    productId: z.string().uuid().optional(),
    attributeType: z.string().optional(),
    attributeGroup: z.string().optional(),
    isActive: z.string().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ConfigAttribute,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'configurator:config_attribute' },
  list: {
    schema: listSchema,
    entityId: 'configurator:config_attribute',
    fields: [
      'id', 'organization_id', 'tenant_id', 'product_id', 'key', 'label',
      'attribute_type', 'allowed_values', 'product_filter_id', 'is_mandatory',
      'display_order', 'default_value', 'attribute_group', 'is_active',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      key: 'key',
      label: 'label',
      displayOrder: 'display_order',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.productId) filters.product_id = { $eq: query.productId }
      if (query.attributeType) filters.attribute_type = { $eq: query.attributeType }
      if (query.attributeGroup) filters.attribute_group = { $eq: query.attributeGroup }
      const activeToken = parseBooleanToken(query.isActive)
      if (activeToken !== null) filters.is_active = { $eq: activeToken }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      if (query.search) {
        filters.$or = [
          { key: { $ilike: `%${escapeLikePattern(query.search)}%` } },
          { label: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'configurator.config_attribute.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(configAttributeCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.configAttributeId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'configurator.config_attribute.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(configAttributeUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'configurator.config_attribute.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const listItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
  key: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  attribute_type: z.string().nullable().optional(),
  allowed_values: z.unknown().nullable().optional(),
  product_filter_id: z.string().uuid().nullable().optional(),
  is_mandatory: z.boolean().nullable().optional(),
  display_order: z.number().nullable().optional(),
  default_value: z.string().nullable().optional(),
  attribute_group: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createConfiguratorCrudOpenApi({
  resourceName: 'Config Attribute',
  pluralName: 'Config Attributes',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: configAttributeCreateSchema,
    description: 'Creates a configuration attribute for a product.',
  },
  update: {
    schema: configAttributeUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a configuration attribute by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a configuration attribute by ID.',
  },
})
