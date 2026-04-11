import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { ConstraintRule } from '../../../data/entities'
import { constraintRuleCreateSchema, constraintRuleUpdateSchema } from '../../../data/validators'
import { createConfiguratorCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['configurator.view'] },
  POST: { requireAuth: true, requireFeatures: ['configurator.edit'] },
  PUT: { requireAuth: true, requireFeatures: ['configurator.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['configurator.edit'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    productId: z.string().uuid().optional(),
    actionType: z.string().optional(),
    isActive: z.string().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ConstraintRule,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'configurator:constraint_rule' },
  list: {
    schema: listSchema,
    entityId: 'configurator:constraint_rule',
    fields: [
      'id', 'organization_id', 'tenant_id', 'product_id', 'condition_json',
      'action_type', 'action_data', 'priority', 'description', 'is_active',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      priority: 'priority',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.productId) filters.product_id = { $eq: query.productId }
      if (query.actionType) filters.action_type = { $eq: query.actionType }
      const activeToken = parseBooleanToken(query.isActive)
      if (activeToken !== null) filters.is_active = { $eq: activeToken }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'configurator.constraint_rule.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(constraintRuleCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.constraintRuleId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'configurator.constraint_rule.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(constraintRuleUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'configurator.constraint_rule.delete',
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
  condition_json: z.unknown().nullable().optional(),
  action_type: z.string().nullable().optional(),
  action_data: z.unknown().nullable().optional(),
  priority: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createConfiguratorCrudOpenApi({
  resourceName: 'Constraint Rule',
  pluralName: 'Constraint Rules',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: constraintRuleCreateSchema,
    description: 'Creates a constraint rule for a product configurator.',
  },
  update: {
    schema: constraintRuleUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a constraint rule by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a constraint rule by ID.',
  },
})
