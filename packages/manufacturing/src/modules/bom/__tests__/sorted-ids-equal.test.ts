import { sortedIdsEqual } from '../lib/sorted-ids-equal'

describe('sortedIdsEqual', () => {
  it('returns true for two empty arrays', () => {
    expect(sortedIdsEqual([], [])).toBe(true)
  })

  it('returns true for identical sorted arrays', () => {
    expect(sortedIdsEqual(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true)
  })

  it('returns false for different lengths', () => {
    expect(sortedIdsEqual(['a', 'b'], ['a', 'b', 'c'])).toBe(false)
    expect(sortedIdsEqual(['a'], [])).toBe(false)
  })

  it('returns false for same length but different elements', () => {
    expect(sortedIdsEqual(['a', 'b', 'c'], ['a', 'b', 'd'])).toBe(false)
    expect(sortedIdsEqual(['x'], ['y'])).toBe(false)
  })

  // Fixed-point invariant in BomTreeView relies on this: the caller
  // guarantees both inputs are pre-sorted, so "same contents in same
  // order" ≡ "same set".
  it('is order-sensitive (caller must pre-sort)', () => {
    expect(sortedIdsEqual(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})
