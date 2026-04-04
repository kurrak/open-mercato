import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { SupplierInfo } from '../../data/entities'
import { supplierInfoCreateSchema, supplierInfoUpdateSchema } from '../../data/validators'
import { createManufacturingCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['product_master.supplier_info.view'] },
  POST: { requireAuth: true, requireFeatures: ['product_master.supplier_info.edit'] },
  PUT: { requireAuth: true, requireFeatures: ['product_master.supplier_info.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['product_master.supplier_info.edit'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    productId: z.string().uuid().optional(),
    isPreferred: z.string().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SupplierInfo,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'product_master:supplier_info' },
  list: {
    schema: listSchema,
    entityId: 'product_master:supplier_info',
    fields: [
      'id', 'organization_id', 'tenant_id', 'product_id',
      'supplier_name', 'supplier_id', 'supplier_sku',
      'price', 'currency', 'min_qty', 'order_multiple',
      'lead_time_days', 'is_preferred',
      'valid_from', 'valid_to', 'variant_id', 'notes',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      supplierName: 'supplier_name',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.productId) filters.product_id = { $eq: query.productId }
      const preferredToken = parseBooleanToken(query.isPreferred)
      if (preferredToken !== undefined) filters.is_preferred = { $eq: preferredToken }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      if (query.search) {
        const like = `%${escapeLikePattern(query.search)}%`
        filters.$or = [
          { supplier_name: { $ilike: like } },
          { supplier_sku: { $ilike: like } },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'product_master.supplierInfo.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(supplierInfoCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.supplierInfoId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'product_master.supplierInfo.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(supplierInfoUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'product_master.supplierInfo.delete',
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
  supplier_name: z.string().nullable().optional(),
  supplier_id: z.string().uuid().nullable().optional(),
  supplier_sku: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  lead_time_days: z.number().nullable().optional(),
  is_preferred: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createManufacturingCrudOpenApi({
  resourceName: 'Supplier info',
  pluralName: 'Supplier infos',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: supplierInfoCreateSchema,
    description: 'Creates supplier information for a product.',
  },
  update: {
    schema: supplierInfoUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates supplier information by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes supplier information by ID.',
  },
})
