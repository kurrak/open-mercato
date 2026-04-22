import { computeLevelGrouping, type DependencyEdge, type FlowOperation } from '../lib/dependency-graph'

function op(id: string, sequence: number): FlowOperation {
  return { id, sequence }
}

function dep(_id: string, pred: string, succ: string): DependencyEdge {
  return { predecessorId: pred, successorId: succ }
}

function idsPerLevel(
  levels: ReturnType<typeof computeLevelGrouping>['levels'],
): string[][] {
  return levels.map((bucket) => bucket.map((entry) => entry.operation.id))
}

describe('computeLevelGrouping', () => {
  it('assigns linear chain to ascending levels', () => {
    const grouping = computeLevelGrouping(
      [op('A', 10), op('B', 20), op('C', 30)],
      [dep('d1', 'A', 'B'), dep('d2', 'B', 'C')],
    )
    expect(idsPerLevel(grouping.levels)).toEqual([['A'], ['B'], ['C']])
    expect(grouping.unreachable).toEqual([])
  })

  it('groups parallel paths at level 0 and converges at level 1', () => {
    const grouping = computeLevelGrouping(
      [op('A', 10), op('B', 20), op('C', 30), op('D', 40)],
      [dep('d1', 'A', 'D'), dep('d2', 'B', 'D'), dep('d3', 'C', 'D')],
    )
    expect(idsPerLevel(grouping.levels)).toEqual([['A', 'B', 'C'], ['D']])
  })

  it('places diamond D after both B and C at level 2', () => {
    const grouping = computeLevelGrouping(
      [op('A', 10), op('B', 20), op('C', 30), op('D', 40)],
      [
        dep('d1', 'A', 'B'),
        dep('d2', 'A', 'C'),
        dep('d3', 'B', 'D'),
        dep('d4', 'C', 'D'),
      ],
    )
    expect(idsPerLevel(grouping.levels)).toEqual([['A'], ['B', 'C'], ['D']])
  })

  it('puts all disconnected operations at level 0', () => {
    const grouping = computeLevelGrouping(
      [op('A', 10), op('B', 20), op('C', 30)],
      [],
    )
    expect(idsPerLevel(grouping.levels)).toEqual([['A', 'B', 'C']])
    expect(grouping.unreachable).toEqual([])
  })

  it('sorts ops within each level by sequence', () => {
    // B has a lower sequence than A — within level 0 both are parallel,
    // so sequence ordering wins as a stable tiebreaker.
    const grouping = computeLevelGrouping(
      [op('A', 20), op('B', 10), op('D', 40)],
      [dep('d1', 'A', 'D'), dep('d2', 'B', 'D')],
    )
    expect(idsPerLevel(grouping.levels)).toEqual([['B', 'A'], ['D']])
  })

  it('reports cycle members as unreachable', () => {
    // A→B→C→A forms a 3-cycle; D is a clean terminal off A.
    const grouping = computeLevelGrouping(
      [op('A', 10), op('B', 20), op('C', 30), op('D', 40)],
      [
        dep('d1', 'A', 'B'),
        dep('d2', 'B', 'C'),
        dep('d3', 'C', 'A'),
        dep('d4', 'A', 'D'),
      ],
    )
    // No op can start (every member of the cycle has an incoming edge
    // from another cycle member), so even D is unreachable because
    // A never gets processed.
    const unreachableIds = grouping.unreachable.map((o) => o.id).sort()
    expect(unreachableIds).toEqual(['A', 'B', 'C', 'D'])
    expect(grouping.levels).toEqual([])
  })

  it('handles the sofa scenario (6 parallel sub-assemblies → assembly → qc)', () => {
    const ops = [
      op('seat', 10),
      op('backrest', 20),
      op('sides', 30),
      op('frame', 40),
      op('covers', 50),
      op('upholstery-sub', 60),
      op('assembly', 70),
      op('qc', 80),
    ]
    const deps = [
      dep('d1', 'seat', 'assembly'),
      dep('d2', 'backrest', 'assembly'),
      dep('d3', 'sides', 'assembly'),
      dep('d4', 'frame', 'assembly'),
      dep('d5', 'covers', 'assembly'),
      dep('d6', 'upholstery-sub', 'assembly'),
      dep('d7', 'assembly', 'qc'),
    ]
    const grouping = computeLevelGrouping(ops, deps)
    expect(grouping.levels).toHaveLength(3)
    expect(idsPerLevel(grouping.levels)[0]).toHaveLength(6)
    expect(idsPerLevel(grouping.levels)[1]).toEqual(['assembly'])
    expect(idsPerLevel(grouping.levels)[2]).toEqual(['qc'])
  })

  it('ignores edges referencing unknown operations', () => {
    const grouping = computeLevelGrouping(
      [op('A', 10), op('B', 20)],
      [
        dep('d1', 'A', 'B'),
        dep('d2', 'A', 'Z'), // unknown successor
        dep('d3', 'Z', 'B'), // unknown predecessor
      ],
    )
    // Stale edges are silently dropped — B still lands at level 1.
    expect(idsPerLevel(grouping.levels)).toEqual([['A'], ['B']])
  })
})
