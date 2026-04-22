/**
 * Pure DAG primitives for operation dependencies.
 *
 * Two public functions share a single graph-build step (`buildGraph`):
 *   - `validateDag` — cycle detection + topological sort for the
 *     /validate-graph endpoint and the UI's client-side pre-check.
 *   - `computeLevelGrouping` — Kahn-BFS assignment of each operation
 *     to an "execution level" for the flow visualization (ops with no
 *     unresolved predecessors → level 0, their successors → level 1,
 *     etc.).
 *
 * Keeping both primitives colocated so a change to cycle semantics
 * (e.g. a future "include optional-strength edges" switch) fans out to
 * both. Extracted from the C6a pass that originally duplicated the
 * Kahn loop in a separate `flow-grouping.ts`.
 */

export type DependencyEdge = {
  predecessorId: string
  successorId: string
}

export type DagValidationResult = {
  valid: boolean
  errors: string[]
  topology: string[]
  /**
   * Structured cycle data when a cycle is detected: the ordered list of
   * operation ids involved in the cycle. `null` when the graph is
   * acyclic OR when the failure is not cycle-related (e.g. self-
   * reference, unknown operation). Consumers that want to render a
   * friendly cycle path (e.g. rewrite ids → names) should read this
   * field instead of string-matching the `errors` text.
   */
  cycle: string[] | null
}

type BuiltGraph = {
  adjacency: Map<string, string[]>
  inDegree: Map<string, number>
  unknownRefs: string[]
}

// Shared adjacency + in-degree build, with unknown-reference collection.
// Consumed by both validateDag (which rejects unknown refs) and
// computeLevelGrouping (which silently drops them — a stale edge
// pointing at a recently-deleted op shouldn't block rendering the
// rest of the flow).
function buildGraph(
  operationIds: readonly string[],
  edges: readonly DependencyEdge[],
): BuiltGraph {
  const adjacency = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  const unknownRefs: string[] = []

  for (const id of operationIds) {
    adjacency.set(id, [])
    inDegree.set(id, 0)
  }

  for (const edge of edges) {
    if (!adjacency.has(edge.predecessorId)) {
      unknownRefs.push(edge.predecessorId)
      continue
    }
    if (!adjacency.has(edge.successorId)) {
      unknownRefs.push(edge.successorId)
      continue
    }
    adjacency.get(edge.predecessorId)!.push(edge.successorId)
    inDegree.set(edge.successorId, (inDegree.get(edge.successorId) ?? 0) + 1)
  }

  return { adjacency, inDegree, unknownRefs }
}

/**
 * Validate that a set of operations and dependencies form a valid DAG.
 * Returns topological order if valid, error descriptions if not.
 *
 * Disconnected operations are valid (Graceful Incompleteness).
 * Multiple terminal operations are valid.
 */
export function validateDag(
  operationIds: string[],
  dependencies: DependencyEdge[],
): DagValidationResult {
  const errors: string[] = []

  for (const dep of dependencies) {
    if (dep.predecessorId === dep.successorId) {
      errors.push(`Self-reference: operation ${dep.predecessorId} depends on itself`)
    }
  }
  if (errors.length > 0) {
    return { valid: false, errors, topology: [], cycle: null }
  }

  const { adjacency, inDegree, unknownRefs } = buildGraph(operationIds, dependencies)
  for (const id of unknownRefs) {
    errors.push(`Dependency references unknown operation: ${id}`)
  }
  if (errors.length > 0) {
    return { valid: false, errors, topology: [], cycle: null }
  }

  const queue: string[] = []
  for (const [opId, degree] of inDegree) {
    if (degree === 0) queue.push(opId)
  }

  const topology: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    topology.push(current)
    for (const successor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(successor) ?? 1) - 1
      inDegree.set(successor, newDegree)
      if (newDegree === 0) queue.push(successor)
    }
  }

  if (topology.length !== operationIds.length) {
    const inCycle = operationIds.filter((id) => !topology.includes(id))
    errors.push(`Cycle detected involving operations: ${inCycle.join(', ')}`)
    return { valid: false, errors, topology: [], cycle: inCycle }
  }

  return { valid: true, errors: [], topology, cycle: null }
}

// ---------------------------------------------------------------------------
// Level grouping for the flow visualization. Consumes the same Kahn
// infrastructure as validateDag so cycle semantics stay consistent.
// ---------------------------------------------------------------------------

export type FlowOperation = {
  id: string
  sequence: number
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

/**
 * Kahn-like BFS that records the longest-path level per operation.
 * An op with multiple predecessors sits at `max(predLevel) + 1`, so
 * convergence points (e.g. upholstery after 6 parallel sub-assemblies)
 * land at the level below the deepest parallel path. Ops unreachable
 * from any level-0 node remain out of the map — they're the set
 * stuck in cycles.
 *
 * Unlike `validateDag`, this function silently drops edges that
 * reference unknown operations. The render surface has no good way to
 * surface a stale-edge error mid-paint; leaving the op reachable via
 * its other (valid) edges produces the least surprising output.
 */
export function computeLevelGrouping<TOp extends FlowOperation>(
  operations: readonly TOp[],
  edges: readonly DependencyEdge[],
): FlowLevelGrouping<TOp> {
  const operationIds = operations.map((op) => op.id)
  const { adjacency, inDegree } = buildGraph(operationIds, edges)

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
