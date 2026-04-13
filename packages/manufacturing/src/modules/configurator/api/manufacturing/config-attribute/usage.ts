import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ConfigAttribute } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['configurator.view'] },
}

const querySchema = z.object({
  id: z.string().uuid(),
})

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: translate('configurator.errors.unauthorized', 'Unauthorized') })
    }
    const organizationId = auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('configurator.errors.organization_required', 'Organization context is required'),
      })
    }

    const url = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsed.success) {
      throw new CrudHttpError(400, {
        error: translate('configurator.errors.invalid_query', 'Invalid query parameters'),
      })
    }

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    const attributes = await findWithDecryption(em, ConfigAttribute, {
      id: parsed.data.id,
      organizationId,
      tenantId: auth.tenantId,
      deletedAt: null,
    })
    const attribute = attributes[0] ?? null
    if (!attribute) {
      throw new CrudHttpError(404, { error: translate('configurator.errors.not_found', 'Attribute not found') })
    }

    const attributeKey = attribute.key
    const productId = attribute.productId
    const knex = em.getConnection().getKnex()

    // Raw SQL required here: MikroORM doesn't support JSONB key-existence checks,
    // and jsonb_exists() avoids ambiguity with knex parameterized query placeholders.
    // The query joins across 3 tables (BomLine→BomHeader, or
    // OperationTemplateVariant→OperationTemplate→RoutingTemplate). These entities
    // don't have encrypted columns — if that changes, switch to QueryBuilder.

    // Count BomLine rows where variant_condition contains this attribute key
    // BomLine → BomHeader (has product_id)
    const bomResult = await knex.raw(
      `SELECT COUNT(*)::int AS count
       FROM manufacturing_bom_lines bl
       JOIN manufacturing_bom_headers bh ON bh.id = bl.bom_header_id
       WHERE bh.product_id = ?
         AND bh.organization_id = ?
         AND bh.tenant_id = ?
         AND bh.deleted_at IS NULL
         AND bl.deleted_at IS NULL
         AND bl.variant_condition IS NOT NULL
         AND jsonb_exists(bl.variant_condition, ?)`,
      [productId, organizationId, auth.tenantId, attributeKey],
    )

    // Count OperationTemplateVariant rows where variant_condition contains this attribute key
    // OperationTemplateVariant → OperationTemplate → RoutingTemplate (has product_id)
    const routingResult = await knex.raw(
      `SELECT COUNT(*)::int AS count
       FROM manufacturing_operation_template_variants otv
       JOIN manufacturing_operation_templates ot ON ot.id = otv.operation_template_id
       JOIN manufacturing_routing_templates rt ON rt.id = ot.routing_template_id
       WHERE rt.product_id = ?
         AND rt.organization_id = ?
         AND rt.tenant_id = ?
         AND rt.deleted_at IS NULL
         AND ot.deleted_at IS NULL
         AND otv.deleted_at IS NULL
         AND otv.variant_condition IS NOT NULL
         AND jsonb_exists(otv.variant_condition, ?)`,
      [productId, organizationId, auth.tenantId, attributeKey],
    )

    const bomLineCount = bomResult?.rows?.[0]?.count ?? 0
    const operationVariantCount = routingResult?.rows?.[0]?.count ?? 0

    return NextResponse.json({ bomLineCount, operationVariantCount })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('configurator.config-attribute-usage.get failed', err)
    return NextResponse.json(
      { error: translate('configurator.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

const responseSchema = z.object({
  bomLineCount: z.number().int().nonnegative(),
  operationVariantCount: z.number().int().nonnegative(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Configurator',
  summary: 'Config attribute usage stats',
  methods: {
    GET: {
      summary: 'Count BOM lines and routing overrides referencing this attribute key',
      description:
        'Used by the delete confirmation dialog to warn about cross-module references before deleting a config attribute.',
      responses: [
        { status: 200, description: 'Usage counts', schema: responseSchema },
        { status: 404, description: 'Attribute not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
