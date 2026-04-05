/**
 * Time rollup calculation for routing operations.
 *
 * Pure function — no DB dependency. Computes per-operation times and
 * critical path through the DAG.
 */

import type { DependencyEdge } from './dependency-graph'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OperationTimeInput = {
  id: string
  setupTime: number | null
  runTime: number | null
  teardownTime: number | null
  queueTime: number | null
  waitTime: number | null
  moveTime: number | null
  workCenterEfficiency: number
}

export type VariantTimeOverride = {
  runTime?: number | null
  setupTime?: number | null
  teardownTime?: number | null
}

export type TimeRollupInput = {
  operations: OperationTimeInput[]
  dependencies: DependencyEdge[]
  quantity: number
  variantOverrides?: Map<string, VariantTimeOverride>
}

export type OperationTimeResult = {
  operationId: string
  occupationMinutes: number
  leadTimeMinutes: number
}

export type TimeRollupResult = {
  totalOccupationMinutes: number
  totalLeadTimeMinutes: number
  perOperation: OperationTimeResult[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

function safeNum(value: number | null | undefined): number {
  if (value == null || isNaN(value)) return 0
  return value
}

export function computeTimeRollup(input: TimeRollupInput): TimeRollupResult {
  const warnings: string[] = []
  const perOperation: OperationTimeResult[] = []
  const operationTimeMap = new Map<string, { occupation: number; lead: number }>()

  for (const op of input.operations) {
    const override = input.variantOverrides?.get(op.id)

    const setupTime = safeNum(override?.setupTime ?? op.setupTime)
    const runTime = safeNum(override?.runTime ?? op.runTime)
    const teardownTime = safeNum(override?.teardownTime ?? op.teardownTime)
    const queueTime = safeNum(op.queueTime)
    const waitTime = safeNum(op.waitTime)
    const moveTime = safeNum(op.moveTime)

    if (op.runTime == null && !override?.runTime) {
      warnings.push(`Operation ${op.id} has null run_time — treated as 0`)
    }

    const efficiency = op.workCenterEfficiency > 0 ? op.workCenterEfficiency : 100
    const occupation = setupTime + (runTime * input.quantity) + teardownTime
    const adjustedOccupation = occupation / (efficiency / 100)
    const leadTime = adjustedOccupation + queueTime + waitTime + moveTime

    operationTimeMap.set(op.id, { occupation: adjustedOccupation, lead: leadTime })
    perOperation.push({
      operationId: op.id,
      occupationMinutes: Math.round(adjustedOccupation * 100) / 100,
      leadTimeMinutes: Math.round(leadTime * 100) / 100,
    })
  }

  const totalOccupation = perOperation.reduce((sum, op) => sum + op.occupationMinutes, 0)

  // Critical path calculation via longest path through DAG
  const totalLeadTime = computeCriticalPath(input.operations, input.dependencies, operationTimeMap)

  return {
    totalOccupationMinutes: Math.round(totalOccupation * 100) / 100,
    totalLeadTimeMinutes: Math.round(totalLeadTime * 100) / 100,
    perOperation,
    warnings,
  }
}

/**
 * Compute critical path (longest path) through the operation DAG.
 * Operations without dependencies are assumed parallel at the start.
 */
function computeCriticalPath(
  operations: OperationTimeInput[],
  dependencies: DependencyEdge[],
  timeMap: Map<string, { occupation: number; lead: number }>,
): number {
  if (operations.length === 0) return 0

  // Build adjacency and in-degree
  const successors = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  for (const op of operations) {
    successors.set(op.id, [])
    inDegree.set(op.id, 0)
  }

  for (const dep of dependencies) {
    if (!successors.has(dep.predecessorId) || !inDegree.has(dep.successorId)) continue
    successors.get(dep.predecessorId)!.push(dep.successorId)
    inDegree.set(dep.successorId, (inDegree.get(dep.successorId) ?? 0) + 1)
  }

  // Longest path via topological order
  const earliest = new Map<string, number>()
  const queue: string[] = []

  for (const [opId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(opId)
      earliest.set(opId, 0)
    }
  }

  const topoOrder: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    topoOrder.push(current)
    const currentFinish = (earliest.get(current) ?? 0) + (timeMap.get(current)?.lead ?? 0)

    for (const succ of successors.get(current) ?? []) {
      const prevEarliest = earliest.get(succ) ?? 0
      earliest.set(succ, Math.max(prevEarliest, currentFinish))

      const newDegree = (inDegree.get(succ) ?? 1) - 1
      inDegree.set(succ, newDegree)
      if (newDegree === 0) queue.push(succ)
    }
  }

  // Critical path = max finish time across all operations
  let maxFinish = 0
  for (const op of operations) {
    const start = earliest.get(op.id) ?? 0
    const lead = timeMap.get(op.id)?.lead ?? 0
    maxFinish = Math.max(maxFinish, start + lead)
  }

  return maxFinish
}
