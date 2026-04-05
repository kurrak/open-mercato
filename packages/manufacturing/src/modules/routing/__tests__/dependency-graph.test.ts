import { validateDag } from '../lib/dependency-graph'

describe('validateDag', () => {
  it('validates linear chain (A→B→C)', () => {
    const result = validateDag(
      ['A', 'B', 'C'],
      [
        { predecessorId: 'A', successorId: 'B' },
        { predecessorId: 'B', successorId: 'C' },
      ],
    )
    expect(result.valid).toBe(true)
    expect(result.topology).toEqual(['A', 'B', 'C'])
    expect(result.errors).toHaveLength(0)
  })

  it('validates parallel paths converging (A→D, B→D, C→D)', () => {
    const result = validateDag(
      ['A', 'B', 'C', 'D'],
      [
        { predecessorId: 'A', successorId: 'D' },
        { predecessorId: 'B', successorId: 'D' },
        { predecessorId: 'C', successorId: 'D' },
      ],
    )
    expect(result.valid).toBe(true)
    expect(result.topology).toContain('D')
    expect(result.topology.indexOf('D')).toBe(3)
  })

  it('validates diamond pattern (A→B, A→C, B→D, C→D)', () => {
    const result = validateDag(
      ['A', 'B', 'C', 'D'],
      [
        { predecessorId: 'A', successorId: 'B' },
        { predecessorId: 'A', successorId: 'C' },
        { predecessorId: 'B', successorId: 'D' },
        { predecessorId: 'C', successorId: 'D' },
      ],
    )
    expect(result.valid).toBe(true)
    expect(result.topology[0]).toBe('A')
    expect(result.topology[3]).toBe('D')
  })

  it('rejects cycle (A→B→A)', () => {
    const result = validateDag(
      ['A', 'B'],
      [
        { predecessorId: 'A', successorId: 'B' },
        { predecessorId: 'B', successorId: 'A' },
      ],
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Cycle'))).toBe(true)
  })

  it('rejects three-node cycle (A→B→C→A)', () => {
    const result = validateDag(
      ['A', 'B', 'C'],
      [
        { predecessorId: 'A', successorId: 'B' },
        { predecessorId: 'B', successorId: 'C' },
        { predecessorId: 'C', successorId: 'A' },
      ],
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Cycle'))).toBe(true)
  })

  it('rejects self-reference', () => {
    const result = validateDag(
      ['A'],
      [{ predecessorId: 'A', successorId: 'A' }],
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Self-reference'))).toBe(true)
  })

  it('validates disconnected operations (Graceful Incompleteness)', () => {
    const result = validateDag(['A', 'B', 'C'], [])
    expect(result.valid).toBe(true)
    expect(result.topology).toHaveLength(3)
  })

  it('validates empty graph', () => {
    const result = validateDag([], [])
    expect(result.valid).toBe(true)
    expect(result.topology).toHaveLength(0)
  })

  it('validates single operation with no dependencies', () => {
    const result = validateDag(['A'], [])
    expect(result.valid).toBe(true)
    expect(result.topology).toEqual(['A'])
  })

  it('validates complex manufacturing scenario (6 parallel paths converging)', () => {
    // Sofa: 6 sub-assemblies in parallel → final assembly → QC
    const ops = ['seat', 'backrest', 'sides', 'frame', 'covers', 'upholstery', 'assembly', 'qc']
    const deps = [
      { predecessorId: 'seat', successorId: 'assembly' },
      { predecessorId: 'backrest', successorId: 'assembly' },
      { predecessorId: 'sides', successorId: 'assembly' },
      { predecessorId: 'frame', successorId: 'assembly' },
      { predecessorId: 'covers', successorId: 'assembly' },
      { predecessorId: 'upholstery', successorId: 'assembly' },
      { predecessorId: 'assembly', successorId: 'qc' },
    ]
    const result = validateDag(ops, deps)
    expect(result.valid).toBe(true)
    expect(result.topology[result.topology.length - 1]).toBe('qc')
    expect(result.topology[result.topology.length - 2]).toBe('assembly')
  })
})
