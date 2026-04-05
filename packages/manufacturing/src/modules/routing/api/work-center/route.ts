import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { WorkCenter } from '../../data/entities'
import { workCenterCreateSchema, workCenterUpdateSchema } from '../../data/validators'
import { createRoutingCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['routing.work_center.view'] },
  POST: { requireAuth: true, requireFeatures: ['routing.work_center.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['routing.work_center.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['routing.work_center.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    factoryZoneId: z.string().uuid().optional(),
    isActive: z.string().optional(),
    schedulingMode: z.string().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: WorkCenter,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'routing:work_center' },
  list: {
    schema: listSchema,
    entityId: 'routing:work_center',
    fields: [
      'id', 'organization_id', 'tenant_id', 'name', 'code', 'factory_zone_id',
      'capacity', 'efficiency_percent', 'scheduling_mode', 'default_hourly_rate',
      'is_active', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      code: 'code',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.factoryZoneId) filters.factory_zone_id = { $eq: query.factoryZoneId }
      if (query.schedulingMode) filters.scheduling_mode = { $eq: query.schedulingMode }
      const activeToken = parseBooleanToken(query.isActive)
      if (activeToken !== undefined) filters.is_active = { $eq: activeToken }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      if (query.search) {
        const pattern = `%${escapeLikePattern(query.search)}%`
        filters.$or = [
          { name: { $ilike: pattern } },
          { code: { $ilike: pattern } },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'routing.work_center.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(workCenterCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.workCenterId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'routing.work_center.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(workCenterUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'routing.work_center.delete',
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
  name: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  factory_zone_id: z.string().uuid().nullable().optional(),
  capacity: z.number().nullable().optional(),
  efficiency_percent: z.number().nullable().optional(),
  scheduling_mode: z.string().nullable().optional(),
  default_hourly_rate: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createRoutingCrudOpenApi({
  resourceName: 'Work Center',
  pluralName: 'Work Centers',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: workCenterCreateSchema,
    description: 'Creates a work center within a factory zone.',
  },
  update: {
    schema: workCenterUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a work center by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a work center by ID.',
  },
})
