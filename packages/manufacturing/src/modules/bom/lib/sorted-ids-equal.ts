// Element-wise equality for two pre-sorted id arrays. Used by the
// BomTreeView fetch-set recursion driver to break out of the fixed
// point once the derived union stops growing — a false negative here
// would infinite-loop, so the helper lives in its own module for
// unit-test isolation.
export function sortedIdsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}
