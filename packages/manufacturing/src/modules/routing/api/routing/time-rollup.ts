import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { OperationTemplate, OperationTemplateVariant, OperationDependency, WorkCenter } from '../../data/entities'
import { computeTimeRollup, type OperationTimeInput, type VariantTimeOverride } from '../../lib/time-rollup'
import { matchVariantCondition } from '../../../bom/lib/bom-explosion'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['routing.view'] },
}

const requestSchema = z.object({
  routingTemplateId: z.string().uuid(),
  quantity: z.number().min(1),
  variantConditions: z.record(z.string(), z.array(z.string())).optional().default({}),
})

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId || !auth.orgId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = requestSchema.parse(body)
    const em = (container.resolve('em') as EntityManager).fork()
    const encScope = { tenantId: auth.tenantId, organizationId: auth.orgId }

    const operations = await findWithDecryption(
      em, OperationTemplate,
      { routingTemplate: parsed.routingTemplateId, organizationId: auth.orgId, tenantId: auth.tenantId, deletedAt: null },
      { populate: ['workCenter'] }, encScope,
    )

    const operationIds = operations.map((op) => op.id)

    const variants = operationIds.length > 0
      ? await findWithDecryption(em, OperationTemplateVariant, { operationTemplate: { $in: operationIds }, organizationId: auth.orgId, tenantId: auth.tenantId, deletedAt: null }, {}, encScope)
      : []

    const dependencies = operationIds.length > 0
      ? await findWithDecryption(em, OperationDependency, { predecessorOperation: { $in: operationIds }, organizationId: auth.orgId, tenantId: auth.tenantId }, {}, encScope)
      : []

    // Build variant overrides map
    const variantOverrides = new Map<string, VariantTimeOverride>()
    for (const v of variants) {
      const opId = typeof v.operationTemplate === 'object' && v.operationTemplate !== null && 'id' in v.operationTemplate
        ? (v.operationTemplate as { id: string }).id : String(v.operationTemplate)

      let matches = false
      if (v.variantCondition && Object.keys(parsed.variantConditions).length > 0) {
        matches = matchVariantCondition(v.variantCondition as Record<string, unknown>, parsed.variantConditions)
      }
      if (matches) {
        const override: VariantTimeOverride = {}
        if (v.runTimeOverride) override.runTime = parseFloat(v.runTimeOverride)
        if (v.setupTimeOverride) override.setupTime = parseFloat(v.setupTimeOverride)
        if (v.teardownTimeOverride) override.teardownTime = parseFloat(v.teardownTimeOverride)
        variantOverrides.set(opId, override)
      }
    }

    // Build operation time inputs
    const operationInputs: OperationTimeInput[] = operations.map((op) => {
      const wc = op.workCenter as WorkCenter | null
      return {
        id: op.id,
        setupTime: op.setupTimeMinutes ? parseFloat(op.setupTimeMinutes) : null,
        runTime: op.runTimeMinutes ? parseFloat(op.runTimeMinutes) : null,
        teardownTime: op.teardownTimeMinutes ? parseFloat(op.teardownTimeMinutes) : null,
        queueTime: op.queueTimeMinutes ? parseFloat(op.queueTimeMinutes) : null,
        waitTime: op.waitTimeMinutes ? parseFloat(op.waitTimeMinutes) : null,
        moveTime: op.moveTimeMinutes ? parseFloat(op.moveTimeMinutes) : null,
        workCenterEfficiency: wc?.efficiencyPercent ?? 100,
      }
    })

    const edges = dependencies.map((dep) => {
      const predRef = dep.predecessorOperation
      const succRef = dep.successorOperation
      return {
        predecessorId: typeof predRef === 'object' && predRef !== null && 'id' in predRef ? (predRef as { id: string }).id : String(predRef),
        successorId: typeof succRef === 'object' && succRef !== null && 'id' in succRef ? (succRef as { id: string }).id : String(succRef),
      }
    })

    const result = computeTimeRollup({
      operations: operationInputs,
      dependencies: edges,
      quantity: parsed.quantity,
      variantOverrides,
    })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 })
    console.error('routing.time-rollup failed', err)
    return NextResponse.json({ error: 'Time rollup calculation failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing Routing',
  summary: 'Compute routing time rollup',
  methods: {
    POST: {
      summary: 'Calculate total occupation and lead time for a routing',
      requestBody: { schema: requestSchema },
      responses: [
        { status: 200, description: 'Time rollup result', schema: z.object({
          totalOccupationMinutes: z.number(),
          totalLeadTimeMinutes: z.number(),
          perOperation: z.array(z.object({ operationId: z.string(), occupationMinutes: z.number(), leadTimeMinutes: z.number() })),
          warnings: z.array(z.string()),
        }) },
        { status: 400, description: 'Invalid input', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
