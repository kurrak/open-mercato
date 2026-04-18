import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { BomLine, BomLineVariant, BomHeader } from '../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['bom.view'] },
}

const querySchema = z.object({
  productId: z.string().uuid(),
  productVariantId: z.string().uuid().optional(),
})

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: translate('bom.errors.unauthorized', 'Unauthorized') })
    }

    const organizationId = auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('bom.errors.organization_required', 'Organization context is required'),
      })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const scope = { organizationId, tenantId: auth.tenantId }

    // Master line matches: product_id, or (when provided) product_variant_id.
    // Resolve-key lines are intentionally not traversed here — their concrete
    // product is only known at explosion time. See spec b §API / Risks.
    const lineWhere: Record<string, unknown> = query.productVariantId
      ? { $or: [{ productId: query.productId }, { productVariantId: query.productVariantId }] }
      : { productId: query.productId }

    const lines = await findWithDecryption(
      em,
      BomLine,
      { ...lineWhere, ...scope, deletedAt: null },
      {},
      { tenantId: auth.tenantId, organizationId },
    )

    // BomLineVariant override matches: product_override_id, or (when provided)
    // product_variant_override_id.
    const overrideWhere: Record<string, unknown> = query.productVariantId
      ? { $or: [{ productOverrideId: query.productId }, { productVariantOverrideId: query.productVariantId }] }
      : { productOverrideId: query.productId }

    const overrides = await findWithDecryption(
      em,
      BomLineVariant,
      { ...overrideWhere, ...scope, deletedAt: null },
      { populate: ['bomLine'] },
      { tenantId: auth.tenantId, organizationId },
    )

    const headerIdSet = new Set<string>()

    for (const line of lines) {
      const ref = line.bomHeader
      const id = typeof ref === 'object' && ref !== null && 'id' in ref
        ? (ref as { id: string }).id
        : String(ref)
      if (id) headerIdSet.add(id)
    }

    for (const override of overrides) {
      const lineRef = override.bomLine
      const line = typeof lineRef === 'object' && lineRef !== null ? lineRef as BomLine : null
      if (!line) continue
      const headerRef = line.bomHeader
      const id = typeof headerRef === 'object' && headerRef !== null && 'id' in headerRef
        ? (headerRef as { id: string }).id
        : String(headerRef)
      if (id) headerIdSet.add(id)
    }

    if (headerIdSet.size === 0) {
      return NextResponse.json({ items: [] })
    }

    const headers = await findWithDecryption(
      em,
      BomHeader,
      {
        id: { $in: [...headerIdSet] },
        ...scope,
        deletedAt: null,
      },
      {},
      { tenantId: auth.tenantId, organizationId },
    )

    const items = headers.map((header) => ({
      bomHeaderId: header.id,
      bomHeaderName: header.name,
      productId: header.productId,
    }))

    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('bom.where-used.get failed', err)
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('bom.errors.where_used_failed', 'Failed to load where-used data.') },
      { status: 400 },
    )
  }
}

const whereUsedItemSchema = z.object({
  bomHeaderId: z.string().uuid(),
  bomHeaderName: z.string(),
  productId: z.string().uuid(),
})

const whereUsedResponseSchema = z.object({
  items: z.array(whereUsedItemSchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing BOM',
  summary: 'Where-used query for a Product or ProductVariant',
  methods: {
    GET: {
      summary: 'Find all BOMs that reference a given Product or ProductVariant',
      description:
        'Matches on the master line\'s product_id / product_variant_id and on BomLineVariant\'s ' +
        'product_override_id / product_variant_override_id. `productVariantId` is optional — when omitted, ' +
        'matches at Product level only. Dynamic (`product_resolve_key`) lines are not traversed — their ' +
        'concrete product is only known at explosion time (see spec b Risks; snapshot-aware variant deferred).',
      query: querySchema,
      responses: [
        { status: 200, description: 'Where-used results', schema: whereUsedResponseSchema },
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
