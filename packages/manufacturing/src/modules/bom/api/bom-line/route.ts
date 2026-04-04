import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BomLine } from '../../data/entities'
import { bomLineCreateSchema, bomLineUpdateSchema } from '../../data/validators'
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
    bomHeaderId: z.string().uuid().optional(),
    materialId: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BomLine,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'bom:bom_line' },
  list: {
    schema: listSchema,
    entityId: 'bom:bom_line',
    fields: [
      'id', 'organization_id', 'tenant_id', 'bom_header_id', 'line_type',
      'material_id', 'child_bom_header_id', 'net_quantity', 'gross_quantity',
      'scrap_percentage', 'uom_id', 'variant_condition', 'operation_template_id',
      'sort_order', 'valid_from', 'valid_to', 'is_consumable', 'notes',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      sortOrder: 'sort_order',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.bomHeaderId) filters.bom_header_id = { $eq: query.bomHeaderId }
      if (query.materialId) filters.material_id = { $eq: query.materialId }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'bom.bomLine.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bomLineCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.bomLineId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'bom.bomLine.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bomLineUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'bom.bomLine.delete',
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
  bom_header_id: z.string().uuid().nullable().optional(),
  line_type: z.string().nullable().optional(),
  material_id: z.string().uuid().nullable().optional(),
  child_bom_header_id: z.string().uuid().nullable().optional(),
  net_quantity: z.string().nullable().optional(),
  gross_quantity: z.string().nullable().optional(),
  scrap_percentage: z.string().nullable().optional(),
  uom_id: z.string().uuid().nullable().optional(),
  variant_condition: z.record(z.string(), z.unknown()).nullable().optional(),
  operation_template_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  valid_from: z.string().nullable().optional(),
  valid_to: z.string().nullable().optional(),
  is_consumable: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createBomCrudOpenApi({
  resourceName: 'BOM line',
  pluralName: 'BOM lines',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: bomLineCreateSchema,
    description: 'Creates a BOM line within a BOM header.',
  },
  update: {
    schema: bomLineUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a BOM line by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a BOM line by ID.',
  },
})
