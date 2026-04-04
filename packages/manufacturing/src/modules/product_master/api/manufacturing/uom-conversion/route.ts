import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { UomConversion } from '../../data/entities'
import { uomConversionCreateSchema, uomConversionUpdateSchema } from '../../data/validators'
import { createManufacturingCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

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
    productId: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: UomConversion,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'product_master:uom_conversion' },
  list: {
    schema: listSchema,
    entityId: 'product_master:uom_conversion',
    fields: [
      'id', 'organization_id', 'tenant_id', 'product_id',
      'from_uom_id', 'to_uom_id', 'factor',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.productId) filters.product_id = { $eq: query.productId }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'product_master.uomConversion.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(uomConversionCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.uomConversionId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'product_master.uomConversion.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(uomConversionUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'product_master.uomConversion.delete',
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
  from_uom_id: z.string().uuid().nullable().optional(),
  to_uom_id: z.string().uuid().nullable().optional(),
  factor: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createManufacturingCrudOpenApi({
  resourceName: 'UoM conversion',
  pluralName: 'UoM conversions',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: uomConversionCreateSchema,
    description: 'Creates a unit of measure conversion for a product.',
  },
  update: {
    schema: uomConversionUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a UoM conversion by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a UoM conversion by ID.',
  },
})
