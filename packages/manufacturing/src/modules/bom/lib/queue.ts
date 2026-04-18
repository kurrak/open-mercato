import { createQueue, type Queue } from '@open-mercato/queue'
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'

export const BOM_EXPLODE_QUEUE = 'bom-explode'

export type BomExplodeJobPayload = {
  progressJobId: string
  bomHeaderId: string
  variantConditions: Record<string, string>
  effectiveDate: string
  maxDepth: number
  scope: {
    organizationId: string
    tenantId: string
    userId?: string | null
  }
}

const queues = new Map<string, Queue<Record<string, unknown>>>()

export function getBomQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const created = process.env.QUEUE_STRATEGY === 'async'
    ? createQueue<Record<string, unknown>>(queueName, 'async', {
        connection: { url: getRedisUrl('QUEUE') },
        concurrency: 2,
      })
    : createQueue<Record<string, unknown>>(queueName, 'local')

  queues.set(queueName, created)
  return created
}
