import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { bomExplosionInputSchema } from '../../data/validators'
import { getBomQueue, BOM_EXPLODE_QUEUE, type BomExplodeJobPayload } from '../../lib/queue'
import { z } from 'zod'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['bom.explode'] },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: translate('bom.errors.unauthorized', 'Unauthorized') })
    }
    const organizationId = auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('bom.errors.organization_required', 'Organization context is required') })
    }

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = bomExplosionInputSchema.parse({
      ...body,
      organizationId,
      tenantId: auth.tenantId,
    })

    const progressService = container.resolve('progressService') as ProgressService
    const progressJob = await progressService.createJob(
      {
        kind: 'bom-explosion',
        title: 'BOM Explosion',
        description: `Exploding BOM ${parsed.bomHeaderId}`,
        totalCount: null,
      },
      { tenantId: auth.tenantId, organizationId, userId: auth.userId },
    )

    const queue = getBomQueue(BOM_EXPLODE_QUEUE)
    const payload: BomExplodeJobPayload = {
      progressJobId: progressJob.id,
      bomHeaderId: parsed.bomHeaderId,
      variantConditions: parsed.variantConditions,
      effectiveDate: (parsed.effectiveDate ?? new Date()).toISOString(),
      maxDepth: parsed.maxDepth,
      scope: {
        organizationId,
        tenantId: auth.tenantId,
        userId: auth.userId,
      },
    }

    await queue.enqueue(payload as unknown as Record<string, unknown>)

    return NextResponse.json({ jobId: progressJob.id }, { status: 202 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 })
    }
    console.error('bom.explode.post failed', err)
    return NextResponse.json({ error: 'Failed to start BOM explosion' }, { status: 500 })
  }
}

const explosionRequestSchema = z.object({
  bomHeaderId: z.string().uuid(),
  variantConditions: z.record(z.string(), z.array(z.string())).optional(),
  effectiveDate: z.string().optional(),
  maxDepth: z.number().int().optional(),
})

const explosionResponseSchema = z.object({
  jobId: z.string().uuid(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing BOM',
  summary: 'Async BOM explosion',
  methods: {
    POST: {
      summary: 'Start an asynchronous BOM explosion',
      description: 'Queues a BOM explosion worker job. Returns a job ID for progress tracking.',
      requestBody: { schema: explosionRequestSchema },
      responses: [
        { status: 202, description: 'Explosion queued', schema: explosionResponseSchema },
        { status: 400, description: 'Invalid input', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
