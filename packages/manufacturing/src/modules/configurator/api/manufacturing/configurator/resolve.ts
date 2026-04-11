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
import { ConfigAttribute, ConstraintRule } from '../../../data/entities'
import { configResolutionInputSchema } from '../../../data/validators'
import { resolveConfiguration } from '../../../lib/config-resolution'
import { emitConfiguratorEvent } from '../../../events'

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
    const parsed = configResolutionInputSchema.parse({
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

    const rules = await findWithDecryption(em, ConstraintRule, {
      organizationId,
      tenantId: auth.tenantId,
      productId: parsed.productId,
      deletedAt: null,
      isActive: true,
    }, { orderBy: { priority: 'DESC', id: 'ASC' } })

    const result = resolveConfiguration({
      productId: parsed.productId,
      configSnapshot: parsed.configSnapshot,
      attributes,
      rules,
    })

    // Fire-and-forget lifecycle event (async, after response)
    emitConfiguratorEvent('configurator.configuration.resolved', {
      productId: parsed.productId,
      resolvedConditions: result.resolvedConditions,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      organizationId,
      tenantId: auth.tenantId,
    }).catch((err) => console.error('Failed to emit configuration.resolved event', err))

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 })
    }
    console.error('configurator.resolve.post failed', err)
    return NextResponse.json({ error: 'Configuration resolution failed' }, { status: 500 })
  }
}

const resolveRequestSchema = z.object({
  productId: z.string().uuid(),
  configSnapshot: z.record(z.string(), z.string()),
})

const resolveResponseSchema = z.object({
  resolvedConditions: z.record(z.string(), z.array(z.string())),
  resolvedSnapshot: z.record(z.string(), z.string()),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  appliedRules: z.array(z.string()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing Configurator',
  summary: 'Resolve product configuration',
  methods: {
    POST: {
      summary: 'Resolve a product configuration snapshot',
      description: 'Takes a configuration snapshot (attribute key→value pairs), evaluates constraint rules, and returns resolved variant conditions for BOM explosion and routing.',
      requestBody: { schema: resolveRequestSchema },
      responses: [
        { status: 200, description: 'Resolution result', schema: resolveResponseSchema },
        { status: 400, description: 'Invalid input', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
