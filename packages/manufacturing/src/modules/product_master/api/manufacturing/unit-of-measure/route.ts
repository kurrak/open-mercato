import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { UnitOfMeasure } from '../../../data/entities'
import { unitOfMeasureCreateSchema, unitOfMeasureUpdateSchema } from '../../../data/validators'
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
    uomType: z.string().optional(),
    isActive: z.string().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: UnitOfMeasure,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'product_master:unit_of_measure' },
  list: {
    schema: listSchema,
    entityId: 'product_master:unit_of_measure',
    fields: [
      'id', 'organization_id', 'tenant_id', 'code', 'name',
      'uom_type', 'is_active', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      code: 'code',
      name: 'name',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.uomType) filters.uom_type = { $eq: query.uomType }
      const activeToken = parseBooleanToken(query.isActive)
      if (activeToken !== null) filters.is_active = { $eq: activeToken }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      if (query.search) {
        const like = `%${escapeLikePattern(query.search)}%`
        filters.$or = [{ code: { $ilike: like } }, { name: { $ilike: like } }]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'product_master.unitOfMeasure.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(unitOfMeasureCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.unitOfMeasureId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'product_master.unitOfMeasure.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(unitOfMeasureUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'product_master.unitOfMeasure.delete',
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
  code: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  uom_type: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createManufacturingCrudOpenApi({
  resourceName: 'Unit of measure',
  pluralName: 'Units of measure',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: unitOfMeasureCreateSchema,
    description: 'Creates a unit of measure.',
  },
  update: {
    schema: unitOfMeasureUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a unit of measure by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a unit of measure by ID.',
  },
})
