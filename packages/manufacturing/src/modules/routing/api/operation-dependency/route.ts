import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { OperationDependency } from '../../data/entities'
import { operationDependencyCreateSchema, operationDependencyUpdateSchema } from '../../data/validators'
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
    predecessorOperationId: z.string().uuid().optional(),
    successorOperationId: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: OperationDependency,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: 'routing:operation_dependency' },
  list: {
    schema: listSchema,
    entityId: 'routing:operation_dependency',
    fields: [
      'id', 'organization_id', 'tenant_id', 'predecessor_operation_id', 'successor_operation_id',
      'dependency_type', 'link_strength', 'overlap_quantity', 'overlap_time_minutes',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.predecessorOperationId) filters.predecessor_operation_id = { $eq: query.predecessorOperationId }
      if (query.successorOperationId) filters.successor_operation_id = { $eq: query.successorOperationId }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'routing.operation_dependency.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(operationDependencyCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.operationDependencyId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'routing.operation_dependency.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(operationDependencyUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'routing.operation_dependency.delete',
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
  predecessor_operation_id: z.string().uuid().nullable().optional(),
  successor_operation_id: z.string().uuid().nullable().optional(),
  dependency_type: z.string().nullable().optional(),
  link_strength: z.string().nullable().optional(),
  overlap_quantity: z.number().nullable().optional(),
  overlap_time_minutes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createRoutingCrudOpenApi({
  resourceName: 'Operation Dependency',
  pluralName: 'Operation Dependencies',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: operationDependencyCreateSchema,
    description: 'Creates a dependency link between two operations in a routing.',
  },
  update: {
    schema: operationDependencyUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an operation dependency by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Hard-deletes an operation dependency by ID.',
  },
})
