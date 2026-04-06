import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { RoutingTemplate } from '../../data/entities'
import { routingTemplateCreateSchema, routingTemplateUpdateSchema } from '../../data/validators'
import { createRoutingCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['routing.view'] },
  POST: { requireAuth: true, requireFeatures: ['routing.create'] },
  PUT: { requireAuth: true, requireFeatures: ['routing.update'] },
  DELETE: { requireAuth: true, requireFeatures: ['routing.delete'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    productId: z.string().uuid().optional(),
    isActive: z.string().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: RoutingTemplate,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'routing:routing_template' },
  list: {
    schema: listSchema,
    entityId: 'routing:routing_template',
    fields: [
      'id', 'organization_id', 'tenant_id', 'product_id',
      'name', 'is_active', 'version', 'notes', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.productId) filters.product_id = { $eq: query.productId }
      const activeToken = parseBooleanToken(query.isActive)
      if (activeToken !== undefined) filters.is_active = { $eq: activeToken }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      if (query.search) {
        filters.name = { $ilike: `%${escapeLikePattern(query.search)}%` }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'routing.routing_template.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(routingTemplateCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.routingTemplateId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'routing.routing_template.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(routingTemplateUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'routing.routing_template.delete',
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
  name: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  version: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createRoutingCrudOpenApi({
  resourceName: 'Routing Template',
  pluralName: 'Routing Templates',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: routingTemplateCreateSchema,
    description: 'Creates a routing template for a product.',
  },
  update: {
    schema: routingTemplateUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a routing template by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a routing template by ID.',
  },
})
