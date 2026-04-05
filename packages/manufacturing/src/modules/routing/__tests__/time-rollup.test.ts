import { computeTimeRollup, type OperationTimeInput } from '../lib/time-rollup'

function makeOp(id: string, overrides: Partial<OperationTimeInput> = {}): OperationTimeInput {
  return {
    id,
    setupTime: null,
    runTime: null,
    teardownTime: null,
    queueTime: null,
    waitTime: null,
    moveTime: null,
    workCenterEfficiency: 100,
    ...overrides,
  }
}

describe('computeTimeRollup', () => {
  it('computes single operation with all 5 time components', () => {
    const result = computeTimeRollup({
      operations: [
        makeOp('op1', {
          setupTime: 10,
          runTime: 5,
          teardownTime: 5,
          queueTime: 15,
          waitTime: 30,
          moveTime: 10,
        }),
      ],
      dependencies: [],
      quantity: 10,
    })

    // occupation = 10 + (5 * 10) + 5 = 65
    // lead = 65 + 15 + 30 + 10 = 120
    expect(result.perOperation).toHaveLength(1)
    expect(result.perOperation[0].occupationMinutes).toBe(65)
    expect(result.perOperation[0].leadTimeMinutes).toBe(120)
    expect(result.totalOccupationMinutes).toBe(65)
    expect(result.totalLeadTimeMinutes).toBe(120)
  })

  it('applies efficiency adjustment', () => {
    const result = computeTimeRollup({
      operations: [
        makeOp('op1', { runTime: 10, workCenterEfficiency: 80 }),
      ],
      dependencies: [],
      quantity: 1,
    })

    // occupation = 0 + (10 * 1) + 0 = 10
    // adjusted = 10 / (80/100) = 12.5
    expect(result.perOperation[0].occupationMinutes).toBe(12.5)
    expect(result.perOperation[0].leadTimeMinutes).toBe(12.5)
  })

  it('applies variant overrides', () => {
    const overrides = new Map([
      ['op1', { runTime: 60 }],
    ])

    const result = computeTimeRollup({
      operations: [
        makeOp('op1', { runTime: 45, setupTime: 10 }),
      ],
      dependencies: [],
      quantity: 1,
      variantOverrides: overrides,
    })

    // override: runTime = 60 (not 45)
    // occupation = 10 + 60 + 0 = 70
    expect(result.perOperation[0].occupationMinutes).toBe(70)
  })

  it('treats null times as 0 and warns', () => {
    const result = computeTimeRollup({
      operations: [makeOp('op1')],
      dependencies: [],
      quantity: 5,
    })

    expect(result.perOperation[0].occupationMinutes).toBe(0)
    expect(result.perOperation[0].leadTimeMinutes).toBe(0)
    expect(result.warnings.some((w) => w.includes('null run_time'))).toBe(true)
  })

  it('computes critical path for sequential operations', () => {
    const result = computeTimeRollup({
      operations: [
        makeOp('A', { runTime: 10 }),
        makeOp('B', { runTime: 20 }),
        makeOp('C', { runTime: 15 }),
      ],
      dependencies: [
        { predecessorId: 'A', successorId: 'B' },
        { predecessorId: 'B', successorId: 'C' },
      ],
      quantity: 1,
    })

    // Sequential: A(10) → B(20) → C(15) = 45
    expect(result.totalLeadTimeMinutes).toBe(45)
    expect(result.totalOccupationMinutes).toBe(45)
  })

  it('computes critical path for parallel operations', () => {
    const result = computeTimeRollup({
      operations: [
        makeOp('A', { runTime: 30 }),
        makeOp('B', { runTime: 10 }),
        makeOp('C', { runTime: 20 }),
        makeOp('D', { runTime: 5 }),
      ],
      dependencies: [
        { predecessorId: 'A', successorId: 'D' },
        { predecessorId: 'B', successorId: 'D' },
        { predecessorId: 'C', successorId: 'D' },
      ],
      quantity: 1,
    })

    // Parallel: max(A=30, B=10, C=20) + D=5 = 35
    expect(result.totalLeadTimeMinutes).toBe(35)
    // Total occupation = 30 + 10 + 20 + 5 = 65
    expect(result.totalOccupationMinutes).toBe(65)
  })

  it('handles manufacturing scenario with parallel sub-assemblies', () => {
    // seat(45min) + backrest(30min) both converge at assembly(20min)
    const result = computeTimeRollup({
      operations: [
        makeOp('seat', { setupTime: 5, runTime: 40 }),
        makeOp('backrest', { setupTime: 5, runTime: 25 }),
        makeOp('assembly', { setupTime: 10, runTime: 10 }),
      ],
      dependencies: [
        { predecessorId: 'seat', successorId: 'assembly' },
        { predecessorId: 'backrest', successorId: 'assembly' },
      ],
      quantity: 1,
    })

    // seat = 5+40 = 45, backrest = 5+25 = 30
    // critical path: max(45, 30) + (10+10) = 45 + 20 = 65
    expect(result.totalLeadTimeMinutes).toBe(65)
  })

  it('handles empty operations list', () => {
    const result = computeTimeRollup({
      operations: [],
      dependencies: [],
      quantity: 1,
    })
    expect(result.totalOccupationMinutes).toBe(0)
    expect(result.totalLeadTimeMinutes).toBe(0)
  })
})
