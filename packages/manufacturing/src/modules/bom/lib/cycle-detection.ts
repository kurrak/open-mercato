/**
 * BOM cycle detection.
 *
 * Traverses child BOM references to detect circular references.
 * Used on save (BomLine create/update) to prevent cycles before they enter the DB.
 */

export type BomLineRef = {
  bomHeaderId: string
  childBomHeaderId: string | null
}

/**
 * Check if adding a child_bom_header_id to a BomLine would create a cycle.
 *
 * @param parentBomHeaderId - The BomHeader that owns the line being created/updated
 * @param childBomHeaderId - The proposed child BomHeader reference
 * @param loadChildLines - Async function to load BomLines for a given BomHeader
 * @param maxDepth - Maximum traversal depth (default 10)
 * @returns The cycle path if a cycle is detected, or null if safe
 */
export async function detectBomCycle(
  parentBomHeaderId: string,
  childBomHeaderId: string,
  loadChildLines: (bomHeaderId: string) => Promise<BomLineRef[]>,
  maxDepth: number = 10,
): Promise<string[] | null> {
  if (parentBomHeaderId === childBomHeaderId) {
    return [parentBomHeaderId, childBomHeaderId]
  }

  const visited = new Set<string>()
  const path: string[] = [parentBomHeaderId]

  async function traverse(currentBomHeaderId: string, depth: number): Promise<string[] | null> {
    if (depth > maxDepth) return null
    if (visited.has(currentBomHeaderId)) return null
    visited.add(currentBomHeaderId)

    const lines = await loadChildLines(currentBomHeaderId)
    for (const line of lines) {
      if (!line.childBomHeaderId) continue
      if (line.childBomHeaderId === parentBomHeaderId) {
        return [...path, currentBomHeaderId, line.childBomHeaderId]
      }
      path.push(currentBomHeaderId)
      const cycle = await traverse(line.childBomHeaderId, depth + 1)
      if (cycle) return cycle
      path.pop()
    }

    return null
  }

  return traverse(childBomHeaderId, 1)
}
