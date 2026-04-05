/**
 * Shared entity utilities for the manufacturing package.
 */

/**
 * Extract the ID from a MikroORM ManyToOne reference.
 * Handles both loaded entities (object with .id) and unloaded references (string/number).
 */
export function extractRefId(ref: unknown): string {
  if (typeof ref === 'object' && ref !== null && 'id' in ref) return (ref as { id: string }).id
  return String(ref)
}
