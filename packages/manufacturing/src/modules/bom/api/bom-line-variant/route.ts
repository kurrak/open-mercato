import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BomLineVariant } from '../../data/entities'
import { bomLineVariantCreateSchema, bomLineVariantUpdateSchema } from '../../data/validators'
import { createBomCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['bom.view'] },
  POST: { requireAuth: true, requireFeatures: ['bom.create'] },
  PUT: { requireAuth: true, requireFeatures: ['bom.update'] },
  DELETE: { requireAuth: true, requireFeatures: ['bom.delete'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    bomLineId: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BomLineVariant,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'bom:bom_line_variant' },
  list: {
    schema: listSchema,
    entityId: 'bom:bom_line_variant',
    fields: [
      'id', 'organization_id', 'tenant_id', 'bom_line_id', 'variant_id',
      'variant_condition', 'quantity_override',
      'product_override_id', 'product_variant_override_id',
      'unit_override_id', 'notes', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.bomLineId) filters.bom_line_id = { $eq: query.bomLineId }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'bom.bom_line_variant.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bomLineVariantCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.bomLineVariantId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'bom.bom_line_variant.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bomLineVariantUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'bom.bom_line_variant.delete',
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
  bom_line_id: z.string().uuid().nullable().optional(),
  variant_id: z.string().uuid().nullable().optional(),
  variant_condition: z.record(z.string(), z.unknown()).nullable().optional(),
  quantity_override: z.string().nullable().optional(),
  product_override_id: z.string().uuid().nullable().optional(),
  product_variant_override_id: z.string().uuid().nullable().optional(),
  unit_override_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createBomCrudOpenApi({
  resourceName: 'BOM line variant',
  pluralName: 'BOM line variants',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: bomLineVariantCreateSchema,
    description: 'Creates a variant override for a BOM line.',
  },
  update: {
    schema: bomLineVariantUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a BOM line variant by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a BOM line variant by ID.',
  },
})
