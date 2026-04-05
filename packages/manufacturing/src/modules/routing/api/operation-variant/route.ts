import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { OperationTemplateVariant } from '../../data/entities'
import { operationTemplateVariantCreateSchema, operationTemplateVariantUpdateSchema } from '../../data/validators'
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
    operationTemplateId: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: OperationTemplateVariant,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'routing:operation_template_variant' },
  list: {
    schema: listSchema,
    entityId: 'routing:operation_template_variant',
    fields: [
      'id', 'organization_id', 'tenant_id', 'operation_template_id', 'variant_id',
      'variant_condition', 'run_time_override', 'setup_time_override', 'teardown_time_override',
      'work_center_override_id', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.operationTemplateId) filters.operation_template_id = { $eq: query.operationTemplateId }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'routing.operation_template_variant.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(operationTemplateVariantCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.operationTemplateVariantId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'routing.operation_template_variant.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(operationTemplateVariantUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'routing.operation_template_variant.delete',
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
  operation_template_id: z.string().uuid().nullable().optional(),
  variant_id: z.string().uuid().nullable().optional(),
  variant_condition: z.record(z.unknown()).nullable().optional(),
  run_time_override: z.string().nullable().optional(),
  setup_time_override: z.string().nullable().optional(),
  teardown_time_override: z.string().nullable().optional(),
  work_center_override_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createRoutingCrudOpenApi({
  resourceName: 'Operation Template Variant',
  pluralName: 'Operation Template Variants',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: operationTemplateVariantCreateSchema,
    description: 'Creates a variant override for an operation template.',
  },
  update: {
    schema: operationTemplateVariantUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an operation template variant by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an operation template variant by ID.',
  },
})
