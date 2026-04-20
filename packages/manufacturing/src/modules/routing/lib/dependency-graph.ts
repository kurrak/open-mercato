/**
 * DAG validation for operation dependencies.
 *
 * Pure function — no DB dependency. Validates that the operation dependency
 * graph is a valid DAG (directed acyclic graph) via topological sort.
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

  // Check for self-references
  for (const dep of dependencies) {
    if (dep.predecessorId === dep.successorId) {
      errors.push(`Self-reference: operation ${dep.predecessorId} depends on itself`)
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, topology: [], cycle: null }
  }

  // Build adjacency list and in-degree map
  const adjacency = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  for (const opId of operationIds) {
    adjacency.set(opId, [])
    inDegree.set(opId, 0)
  }

  for (const dep of dependencies) {
    if (!adjacency.has(dep.predecessorId)) {
      errors.push(`Dependency references unknown operation: ${dep.predecessorId}`)
      continue
    }
    if (!adjacency.has(dep.successorId)) {
      errors.push(`Dependency references unknown operation: ${dep.successorId}`)
      continue
    }
    adjacency.get(dep.predecessorId)!.push(dep.successorId)
    inDegree.set(dep.successorId, (inDegree.get(dep.successorId) ?? 0) + 1)
  }

  if (errors.length > 0) {
    return { valid: false, errors, topology: [], cycle: null }
  }

  // Kahn's algorithm for topological sort
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
