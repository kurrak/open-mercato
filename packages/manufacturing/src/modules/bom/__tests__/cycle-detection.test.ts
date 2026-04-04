import { detectBomCycle, type BomLineRef } from '../lib/cycle-detection'

function makeLineRefs(refs: Array<{ bomHeaderId: string; childBomHeaderId: string | null }>): BomLineRef[] {
  return refs
}

describe('detectBomCycle', () => {
  it('detects direct self-reference', async () => {
    const result = await detectBomCycle('bom-A', 'bom-A', async () => [])
    expect(result).not.toBeNull()
  })

  it('detects two-node cycle (A → B → A)', async () => {
    const loader = async (bomHeaderId: string) => {
      if (bomHeaderId === 'bom-B') {
        return makeLineRefs([{ bomHeaderId: 'bom-B', childBomHeaderId: 'bom-A' }])
      }
      return []
    }
    const result = await detectBomCycle('bom-A', 'bom-B', loader)
    expect(result).not.toBeNull()
    expect(result).toContain('bom-A')
  })

  it('detects three-node cycle (A → B → C → A)', async () => {
    const loader = async (bomHeaderId: string) => {
      if (bomHeaderId === 'bom-B') return makeLineRefs([{ bomHeaderId: 'bom-B', childBomHeaderId: 'bom-C' }])
      if (bomHeaderId === 'bom-C') return makeLineRefs([{ bomHeaderId: 'bom-C', childBomHeaderId: 'bom-A' }])
      return []
    }
    const result = await detectBomCycle('bom-A', 'bom-B', loader)
    expect(result).not.toBeNull()
  })

  it('returns null for valid tree (no cycle)', async () => {
    const loader = async (bomHeaderId: string) => {
      if (bomHeaderId === 'bom-B') return makeLineRefs([{ bomHeaderId: 'bom-B', childBomHeaderId: 'bom-C' }])
      if (bomHeaderId === 'bom-C') return makeLineRefs([])
      return []
    }
    const result = await detectBomCycle('bom-A', 'bom-B', loader)
    expect(result).toBeNull()
  })

  it('respects max depth limit', async () => {
    const loader = async (bomHeaderId: string) => {
      const level = parseInt(bomHeaderId.split('-')[1])
      return makeLineRefs([{ bomHeaderId, childBomHeaderId: `bom-${level + 1}` }])
    }
    const result = await detectBomCycle('bom-0', 'bom-1', loader, 3)
    expect(result).toBeNull()
  })

  it('handles empty child lines', async () => {
    const result = await detectBomCycle('bom-A', 'bom-B', async () => [])
    expect(result).toBeNull()
  })
})
