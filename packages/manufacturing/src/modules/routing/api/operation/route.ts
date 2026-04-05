import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { OperationTemplate } from '../../data/entities'
import { operationTemplateCreateSchema, operationTemplateUpdateSchema } from '../../data/validators'
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
    routingTemplateId: z.string().uuid().optional(),
    workCenterId: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: OperationTemplate,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'routing:operation_template' },
  list: {
    schema: listSchema,
    entityId: 'routing:operation_template',
    fields: [
      'id', 'organization_id', 'tenant_id', 'routing_template_id', 'work_center_id',
      'sequence', 'name', 'setup_time_minutes', 'run_time_minutes', 'teardown_time_minutes',
      'queue_time_minutes', 'wait_time_minutes', 'move_time_minutes', 'payment_type',
      'piecework_rate', 'hourly_rate', 'is_subcontracted', 'allow_splitting',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      sequence: 'sequence',
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.routingTemplateId) filters.routing_template_id = { $eq: query.routingTemplateId }
      if (query.workCenterId) filters.work_center_id = { $eq: query.workCenterId }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'routing.operation_template.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(operationTemplateCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.operationTemplateId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'routing.operation_template.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(operationTemplateUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'routing.operation_template.delete',
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
  routing_template_id: z.string().uuid().nullable().optional(),
  work_center_id: z.string().uuid().nullable().optional(),
  sequence: z.number().nullable().optional(),
  name: z.string().nullable().optional(),
  setup_time_minutes: z.string().nullable().optional(),
  run_time_minutes: z.string().nullable().optional(),
  teardown_time_minutes: z.string().nullable().optional(),
  queue_time_minutes: z.string().nullable().optional(),
  wait_time_minutes: z.string().nullable().optional(),
  move_time_minutes: z.string().nullable().optional(),
  payment_type: z.string().nullable().optional(),
  piecework_rate: z.string().nullable().optional(),
  hourly_rate: z.string().nullable().optional(),
  is_subcontracted: z.boolean().nullable().optional(),
  allow_splitting: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createRoutingCrudOpenApi({
  resourceName: 'Operation Template',
  pluralName: 'Operation Templates',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: operationTemplateCreateSchema,
    description: 'Creates an operation template within a routing.',
  },
  update: {
    schema: operationTemplateUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an operation template by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an operation template by ID.',
  },
})
