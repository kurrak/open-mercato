import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { OperationTemplate } from '../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['routing.work_center.view'] },
}

const querySchema = z.object({
  id: z.string().uuid(),
})

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: translate('manufacturing.errors.unauthorized', 'Unauthorized') })
    }
    const organizationId = auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('manufacturing.errors.organization_required', 'Organization context is required'),
      })
    }

    const url = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsed.success) {
      throw new CrudHttpError(400, {
        error: translate('manufacturing.errors.invalid_query', 'Invalid query parameters'),
      })
    }

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    // TODO(perf): switch to a two-query SQL count + distinct routing via
    // em.getConnection().execute(`SELECT COUNT(*), COUNT(DISTINCT routing_template_id)
    // FROM routing_operation_templates WHERE ...`) once we have >1k operations per work
    // center. Loading the full row set is fine at current scale but unnecessary.
    const operations = await em.find(
      OperationTemplate,
      {
        organizationId,
        tenantId: auth.tenantId,
        workCenter: parsed.data.id,
        deletedAt: null,
      },
      { fields: ['id', 'routingTemplate'] as const },
    )

    const routingIds = new Set<string>()
    for (const op of operations) {
      const routingRef = (op as unknown as { routingTemplate?: { id?: string } | string | null }).routingTemplate
      const routingId =
        typeof routingRef === 'string'
          ? routingRef
          : routingRef && typeof routingRef === 'object' && 'id' in routingRef
            ? (routingRef.id ?? null)
            : null
      if (routingId) routingIds.add(routingId)
    }

    return NextResponse.json({
      operationCount: operations.length,
      routingCount: routingIds.size,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('manufacturing.work-center-usage.get failed', err)
    return NextResponse.json(
      {
        error: translate(
          'manufacturing.errors.internal_server_error',
          'Internal server error',
        ),
      },
      { status: 500 },
    )
  }
}

const responseSchema = z.object({
  operationCount: z.number().int().nonnegative(),
  routingCount: z.number().int().nonnegative(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing Routing',
  summary: 'Work center usage stats',
  methods: {
    GET: {
      summary: 'Returns the number of operation templates (and distinct routings) that reference a work center',
      description:
        'Used by the work center detail page to render a read-only "Used by N operations across M routings" summary.',
      responses: [
        { status: 200, description: 'Work center usage', schema: responseSchema },
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
