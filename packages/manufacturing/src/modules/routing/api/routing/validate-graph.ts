import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { OperationTemplate, OperationDependency } from '../../data/entities'
import { extractRefId } from '../../../../lib/entity-utils'
import { validateDag } from '../../lib/dependency-graph'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['routing.view'] },
}

const requestSchema = z.object({
  routingTemplateId: z.string().uuid(),
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
      {}, encScope,
    )

    const operationIds = operations.map((op) => op.id)

    const dependencies = await findWithDecryption(
      em, OperationDependency,
      { predecessorOperation: { $in: operationIds }, organizationId: auth.orgId, tenantId: auth.tenantId, deletedAt: null },
      {}, encScope,
    )

    const edges = dependencies.map((dep) => ({
      predecessorId: extractRefId(dep.predecessorOperation),
      successorId: extractRefId(dep.successorOperation),
    }))

    const result = validateDag(operationIds, edges)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 })
    console.error('routing.validate-graph failed', err)
    return NextResponse.json({ error: 'DAG validation failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing Routing',
  summary: 'Validate operation dependency graph',
  methods: {
    POST: {
      summary: 'Validate that routing operations form a valid DAG',
      requestBody: { schema: requestSchema },
      responses: [
        { status: 200, description: 'Validation result', schema: z.object({ valid: z.boolean(), errors: z.array(z.string()), topology: z.array(z.string()) }) },
        { status: 400, description: 'Invalid input', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
