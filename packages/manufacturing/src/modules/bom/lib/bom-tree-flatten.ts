/**
 * Pure flatten pass for the §4 tree view — converts the top-level BomLine
 * list + expansion-state maps into a linear sequence of display rows the
 * renderer walks once. No React / UI imports; isolates the recursion +
 * cycle-guard logic so it can be unit-tested under the existing node-env
 * jest config.
 *
 *   display rows:
 *     - 'line'     — a BomLine rendered at some depth with isFirst/isLast
 *                    within its sibling group + cycle flag for the left
 *                    expand arrow.
 *     - 'variants' — inline overrides section for a line (rendered as a
 *                    full-width detail row beneath its parent).
 *     - 'add'      — the "+ Add line" pseudo-row that terminates each
 *                    rendered BomHeader's line group.
 */

export type MinimalBomLine = {
  id: string
  bom_header_id: string
  line_type: string
  child_bom_header_id: string | null
  [key: string]: unknown
}

export type LineDisplayRow<TLine extends MinimalBomLine> = {
  type: 'line'
  depth: number
  line: TLine
  bomHeaderId: string
  isFirst: boolean
  isLast: boolean
  cycle: boolean
}

export type VariantsDisplayRow<TLine extends MinimalBomLine> = {
  type: 'variants'
  depth: number
  line: TLine
}

export type AddLineDisplayRow = {
  type: 'add'
  depth: number
  bomHeaderId: string
  isEmptyHeader: boolean
}

export type DisplayRow<TLine extends MinimalBomLine> =
  | LineDisplayRow<TLine>
  | VariantsDisplayRow<TLine>
  | AddLineDisplayRow

export type BuildDisplayRowsInput<TLine extends MinimalBomLine> = {
  topLevelHeaderId: string
  topLevelLines: readonly TLine[]
  childLinesByHeader: ReadonlyMap<string, readonly TLine[]>
  expandedChildrenIds: ReadonlySet<string>
  expandedVariantsIds: ReadonlySet<string>
}

export function buildDisplayRows<TLine extends MinimalBomLine>(
  input: BuildDisplayRowsInput<TLine>,
): DisplayRow<TLine>[] {
  const out: DisplayRow<TLine>[] = []

  function pushHeaderBlock(
    headerId: string,
    lines: readonly TLine[],
    depth: number,
    ancestorHeaderIds: ReadonlySet<string>,
  ): void {
    lines.forEach((line, index) => {
      const childHeaderId = line.child_bom_header_id ?? null
      const cycle = childHeaderId != null && ancestorHeaderIds.has(childHeaderId)
      out.push({
        type: 'line',
        depth,
        line,
        bomHeaderId: headerId,
        isFirst: index === 0,
        isLast: index === lines.length - 1,
        cycle,
      })

      if (input.expandedVariantsIds.has(line.id)) {
        out.push({ type: 'variants', depth, line })
      }

      if (
        !cycle &&
        line.line_type === 'semi_product' &&
        childHeaderId &&
        input.expandedChildrenIds.has(line.id)
      ) {
        const childLines = input.childLinesByHeader.get(childHeaderId)
        if (childLines) {
          pushHeaderBlock(
            childHeaderId,
            childLines,
            depth + 1,
            new Set([...ancestorHeaderIds, childHeaderId]),
          )
        }
      }
    })

    out.push({
      type: 'add',
      depth,
      bomHeaderId: headerId,
      isEmptyHeader: lines.length === 0,
    })
  }

  pushHeaderBlock(
    input.topLevelHeaderId,
    input.topLevelLines,
    0,
    new Set([input.topLevelHeaderId]),
  )
  return out
}
