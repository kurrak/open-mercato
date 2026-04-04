import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { BomLine, BomHeader } from '../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['bom.view'] },
}

const querySchema = z.object({
  materialId: z.string().uuid(),
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

    const lines = await findWithDecryption(
      em,
      BomLine,
      {
        materialId: query.materialId,
        organizationId,
        tenantId: auth.tenantId,
        deletedAt: null,
      },
      {},
      { tenantId: auth.tenantId, organizationId },
    )

    if (lines.length === 0) {
      return NextResponse.json({ items: [] })
    }

    const headerIds = [...new Set(lines.map((line) => {
      const ref = line.bomHeader
      if (typeof ref === 'object' && ref !== null && 'id' in ref) return (ref as { id: string }).id
      return String(ref)
    }))]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)

    if (headerIds.length === 0) {
      return NextResponse.json({ items: [] })
    }

    const headers = await findWithDecryption(
      em,
      BomHeader,
      {
        id: { $in: headerIds },
        organizationId,
        tenantId: auth.tenantId,
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
  summary: 'Where-used query for a material',
  methods: {
    GET: {
      summary: 'Find all BOMs that reference a given material',
      query: querySchema,
      responses: [
        { status: 200, description: 'Where-used results', schema: whereUsedResponseSchema },
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
