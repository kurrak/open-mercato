import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ConfigAttribute } from '../../../data/entities'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['configurator.edit'] },
}

const reorderSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
})

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: translate('configurator.errors.unauthorized', 'Unauthorized') })
    }
    const organizationId = auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('configurator.errors.organization_required', 'Organization context is required') })
    }

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = reorderSchema.parse(body)

    const em = (container.resolve('em') as EntityManager).fork()

    const [sourceRows, targetRows] = await Promise.all([
      findWithDecryption(em, ConfigAttribute, {
        id: parsed.sourceId,
        organizationId,
        tenantId: auth.tenantId,
        deletedAt: null,
      }),
      findWithDecryption(em, ConfigAttribute, {
        id: parsed.targetId,
        organizationId,
        tenantId: auth.tenantId,
        deletedAt: null,
      }),
    ])

    const source = sourceRows[0] ?? null
    const target = targetRows[0] ?? null

    if (!source || !target) {
      throw new CrudHttpError(404, { error: translate('configurator.errors.not_found', 'Attribute not found') })
    }

    if (source.productId !== target.productId) {
      throw new CrudHttpError(400, { error: translate('configurator.errors.product_mismatch', 'Attributes must belong to the same product') })
    }

    const sourceOrder = source.displayOrder
    const targetOrder = target.displayOrder

    source.displayOrder = targetOrder
    target.displayOrder = sourceOrder
    await em.flush()

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Configurator',
  summary: 'Swap display order of two config attributes',
  methods: {
    POST: {
      summary: 'Atomically swap display_order between two attributes',
      requestBody: {
        schema: reorderSchema,
      },
      responses: [
        { status: 200, description: 'Order swapped' },
        { status: 404, description: 'Attribute not found' },
      ],
    },
  },
}
