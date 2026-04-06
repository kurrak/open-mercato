import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { ProductionMethod } from '../../../data/entities'
import { productionMethodCreateSchema, productionMethodUpdateSchema } from '../../../data/validators'
import { createManufacturingCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['product_master.view'] },
  POST: { requireAuth: true, requireFeatures: ['product_master.edit'] },
  PUT: { requireAuth: true, requireFeatures: ['product_master.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['product_master.edit'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    productId: z.string().uuid().optional(),
    lifecycleState: z.string().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ProductionMethod,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'product_master:production_method' },
  list: {
    schema: listSchema,
    entityId: 'product_master:production_method',
    fields: [
      'id', 'organization_id', 'tenant_id', 'product_id', 'name',
      'bom_header_id', 'routing_template_id', 'is_default',
      'variant_condition', 'version', 'valid_from', 'valid_to',
      'lifecycle_state', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.productId) filters.product_id = { $eq: query.productId }
      if (query.lifecycleState) filters.lifecycle_state = { $eq: query.lifecycleState }
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
      commandId: 'product_master.productionMethod.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(productionMethodCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.productionMethodId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'product_master.productionMethod.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(productionMethodUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'product_master.productionMethod.delete',
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
  bom_header_id: z.string().uuid().nullable().optional(),
  routing_template_id: z.string().uuid().nullable().optional(),
  is_default: z.boolean().nullable().optional(),
  lifecycle_state: z.string().nullable().optional(),
  version: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createManufacturingCrudOpenApi({
  resourceName: 'Production method',
  pluralName: 'Production methods',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: productionMethodCreateSchema,
    description: 'Creates a production method for a catalog product.',
  },
  update: {
    schema: productionMethodUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a production method by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a production method by ID.',
  },
})
