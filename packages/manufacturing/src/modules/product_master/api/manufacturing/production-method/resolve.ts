import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { ProductionMethod } from '../../../data/entities'
import { productionMethodResolveSchema } from '../../../data/validators'
import { resolveProductionMethod } from '../../../lib/resolve-production-method'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['product_master.view'] },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: translate('manufacturing.errors.unauthorized', 'Unauthorized') })
    }
    const organizationId = auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('manufacturing.errors.organization_required', 'Organization context is required'),
      })
    }

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = productionMethodResolveSchema.parse(body)

    const em = (container.resolve('em') as EntityManager).fork()
    const productionMethods = await em.find(ProductionMethod, {
      organizationId,
      tenantId: auth.tenantId,
      productId: parsed.productId,
      deletedAt: null,
    })

    const result = resolveProductionMethod(productionMethods, parsed.variantConditions)

    return NextResponse.json({
      productionMethod: result.productionMethod
        ? {
            id: result.productionMethod.id,
            name: result.productionMethod.name,
            bomHeaderId: result.productionMethod.bomHeaderId ?? null,
            routingTemplateId: result.productionMethod.routingTemplateId ?? null,
            isDefault: result.productionMethod.isDefault,
            lifecycleState: result.productionMethod.lifecycleState,
            variantCondition: result.productionMethod.variantCondition ?? null,
          }
        : null,
      fallback: result.fallback,
      warnings: result.warnings,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        { error: translate('manufacturing.errors.invalid_query', 'Invalid query parameters') },
        { status: 400 },
      )
    }
    console.error('production-method.resolve.post failed', err)
    return NextResponse.json({ error: 'Failed to resolve production method' }, { status: 500 })
  }
}

const resolveResponseSchema = z.object({
  productionMethod: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      bomHeaderId: z.string().uuid().nullable(),
      routingTemplateId: z.string().uuid().nullable(),
      isDefault: z.boolean(),
      lifecycleState: z.string(),
      variantCondition: z.record(z.string(), z.unknown()).nullable(),
    })
    .nullable(),
  fallback: z.enum(['variant_match', 'default', 'none']),
  warnings: z.array(z.string()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing Product Master',
  summary: 'Resolve production method',
  methods: {
    POST: {
      summary: 'Resolve best production method for a product',
      description:
        'Given a product ID and optional variant conditions, resolves the best matching production method. ' +
        'Tries variant match first, then falls back to default PM, then returns null.',
      requestBody: { schema: productionMethodResolveSchema },
      responses: [
        { status: 200, description: 'Resolved production method', schema: resolveResponseSchema },
        { status: 400, description: 'Invalid input', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
