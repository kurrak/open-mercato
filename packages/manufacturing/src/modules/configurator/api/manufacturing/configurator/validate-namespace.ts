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
import { namespaceValidationInputSchema } from '../../../data/validators'
import { validateNamespace } from '../../../lib/namespace-validator'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['configurator.view'] },
}

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
    const parsed = namespaceValidationInputSchema.parse({
      ...body,
      organizationId,
      tenantId: auth.tenantId,
    })

    const em = container.resolve('em') as EntityManager

    const attributes = await findWithDecryption(em, ConfigAttribute, {
      organizationId,
      tenantId: auth.tenantId,
      productId: parsed.productId,
      deletedAt: null,
    })

    const result = validateNamespace(parsed.variantCondition, attributes)

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 })
    }
    console.error('configurator.validate-namespace.post failed', err)
    return NextResponse.json({ error: 'Namespace validation failed' }, { status: 500 })
  }
}

const validateNamespaceRequestSchema = z.object({
  productId: z.string().uuid(),
  variantCondition: z.record(z.string(), z.unknown()),
})

const validateNamespaceResponseSchema = z.object({
  valid: z.boolean(),
  unknownKeys: z.array(z.string()),
  warnings: z.array(z.string()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing Configurator',
  summary: 'Validate namespace keys',
  methods: {
    POST: {
      summary: 'Validate variant_condition keys against ConfigAttribute names',
      description: 'Checks whether the keys in a variant_condition object match existing ConfigAttribute keys for the given product.',
      requestBody: { schema: validateNamespaceRequestSchema },
      responses: [
        { status: 200, description: 'Validation result', schema: validateNamespaceResponseSchema },
        { status: 400, description: 'Invalid input', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
