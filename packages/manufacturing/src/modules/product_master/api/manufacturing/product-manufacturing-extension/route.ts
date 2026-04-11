import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ProductManufacturingExtension } from '../../../data/entities'
import { productMfgExtensionCreateSchema, productMfgExtensionUpdateSchema } from '../../../data/validators'
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
    productId: z.string().optional(),
    ids: z.string().optional(),
    fields: z.string().optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ProductManufacturingExtension,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'product_master:product_manufacturing_extension' },
  list: {
    schema: listSchema,
    entityId: 'product_master:product_manufacturing_extension',
    fields: [
      'id', 'organization_id', 'tenant_id', 'product_id',
      'configuration_type', 'procurement_type', 'base_uom_id',
      'is_phantom_default', 'created_at', 'updated_at',
    ],
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
      commandId: 'product_master.productManufacturingExtension.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(productMfgExtensionCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: String((result as Record<string, unknown>)?.id ?? '') }),
      status: 201,
    },
    update: {
      commandId: 'product_master.productManufacturingExtension.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(productMfgExtensionUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'product_master.productManufacturingExtension.delete',
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
  product_id: z.string().uuid().nullable().optional(),
  configuration_type: z.string().nullable().optional(),
  procurement_type: z.string().nullable().optional(),
  base_uom_id: z.string().uuid().nullable().optional(),
  is_phantom_default: z.boolean().nullable().optional(),
})

export const openApi = createManufacturingCrudOpenApi({
  resourceName: 'ProductManufacturingExtension',
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: { schema: productMfgExtensionCreateSchema, description: 'Enable manufacturing for a catalog product' },
  update: { schema: productMfgExtensionUpdateSchema, responseSchema: defaultOkResponseSchema, description: 'Update manufacturing extension' },
  del: { responseSchema: defaultOkResponseSchema, description: 'Remove manufacturing extension' },
})
