/**
 * Pure level-assignment for the routing flow visualization.
 *
 * Kahn-like BFS that records the longest-path level per operation. An op
 * with multiple predecessors sits at `max(predLevel) + 1`, so convergence
 * points (e.g. upholstery after 6 parallel sub-assemblies) land on the
 * level below the deepest parallel path. Ops unreachable from any level-0
 * node remain out of the map — they're the set stuck in cycles.
 *
 * Extracted from `components/FlowVisualization.tsx` so unit tests can
 * import it without pulling the UI dependency graph.
 */

export type FlowOperation = {
  id: string
  sequence: number
}

export type FlowEdge = {
  predecessorId: string
  successorId: string
}

export type FlowLevelEntry<TOp extends FlowOperation> = {
  operation: TOp
  level: number
}

export type FlowLevelGrouping<TOp extends FlowOperation> = {
  /** Ordered buckets; index N contains the ops at level N. */
  levels: FlowLevelEntry<TOp>[][]
  /** Ops unreachable from any level-0 node — i.e. stuck in a cycle. */
  unreachable: TOp[]
}

export function computeLevelGrouping<TOp extends FlowOperation>(
  operations: readonly TOp[],
  edges: readonly FlowEdge[],
): FlowLevelGrouping<TOp> {
  const opsById = new Map<string, TOp>()
  for (const op of operations) opsById.set(op.id, op)

  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const op of operations) {
    inDegree.set(op.id, 0)
    adjacency.set(op.id, [])
  }
  for (const edge of edges) {
    if (!opsById.has(edge.predecessorId) || !opsById.has(edge.successorId)) continue
    adjacency.get(edge.predecessorId)!.push(edge.successorId)
    inDegree.set(edge.successorId, (inDegree.get(edge.successorId) ?? 0) + 1)
  }

  const levels = new Map<string, number>()
  const queue: { id: string; level: number }[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      levels.set(id, 0)
      queue.push({ id, level: 0 })
    }
  }

  while (queue.length > 0) {
    const { id, level } = queue.shift()!
    for (const next of adjacency.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, newDeg)
      const prevLevel = levels.get(next) ?? -1
      const nextLevel = Math.max(prevLevel, level + 1)
      levels.set(next, nextLevel)
      if (newDeg === 0) queue.push({ id: next, level: nextLevel })
    }
  }

  const maxLevel = Array.from(levels.values()).reduce((a, b) => Math.max(a, b), -1)
  const buckets: FlowLevelEntry<TOp>[][] = []
  for (let i = 0; i <= maxLevel; i += 1) buckets.push([])

  for (const op of operations) {
    const lvl = levels.get(op.id)
    if (lvl == null) continue
    buckets[lvl].push({ operation: op, level: lvl })
  }
  for (const bucket of buckets) {
    bucket.sort((a, b) => a.operation.sequence - b.operation.sequence)
  }

  const unreachable = operations.filter((op) => !levels.has(op.id))

  return { levels: buckets, unreachable }
}
