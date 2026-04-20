'use client'

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { NameWithCode } from '../../../lib/components'
import { useOperationsForRouting, type OperationRow } from '../hooks/useOperationsForRouting'
import { useOperationDependencies, type OperationDependencyRow } from '../hooks/useOperationDependencies'
import { useWorkCenterLookup } from '../hooks/useWorkCenterLookup'
import { computeLevelGrouping, type FlowEdge } from '../lib/flow-grouping'

export type FlowVisualizationProps = {
  routingTemplateId: string
}

// Grid cell sizing — kept as module-level constants so the SVG overlay's
// bezier control points can align with the same measurements.
const COLUMN_WIDTH = 220
const COLUMN_GAP = 72
const ROW_GAP = 32

type ConnectorLine = {
  id: string
  d: string
  strength: OperationDependencyRow['link_strength']
}

/**
 * Horizontal timeline flow visualization of the routing's operations.
 * Columns are execution levels, left-to-right = earlier-to-later. Cards
 * within a column are parallel operations at that level. Dependencies
 * render as SVG bezier connectors between specific operation cards —
 * so "seat → assembly" shows the actual arc, not just a generic
 * "between-levels" arrow.
 *
 * Required-strength edges draw solid; optional-strength edges draw
 * dashed (matches the schedule metadata semantics — both count for time
 * rollup today, optional reserved for future scheduling relaxation).
 *
 * Cycle-stuck operations are surfaced below the grid under a warning.
 * The UI-side cycle check in OperationDependencyDialog is the first
 * line of defence; this render path just stays readable if one slips
 * through (e.g. direct POST bypasses the UI).
 *
 * Implementation: plain CSS grid + absolute-positioned SVG overlay that
 * measures card rects via refs and redraws on ResizeObserver. No graph
 * library — OM spec c §6 defers interactive drag editors.
 */
export function FlowVisualization({ routingTemplateId }: FlowVisualizationProps) {
  const t = useT()
  const { rows: operations, isLoading: opsLoading, isError: opsError } =
    useOperationsForRouting(routingTemplateId)
  const operationIds = React.useMemo(() => operations.map((op) => op.id), [operations])
  const { rows: dependencies, isLoading: depsLoading, isError: depsError } =
    useOperationDependencies(operationIds)

  const workCenterIds = React.useMemo(
    () =>
      operations
        .map((op) => op.work_center_id)
        .filter((id): id is string => typeof id === 'string'),
    [operations],
  )
  const workCentersById = useWorkCenterLookup(workCenterIds)

  const grouping = React.useMemo(() => {
    const edges: FlowEdge[] = dependencies.map((dep) => ({
      predecessorId: dep.predecessor_operation_id,
      successorId: dep.successor_operation_id,
    }))
    return computeLevelGrouping(operations, edges)
  }, [operations, dependencies])

  // Measure card rects and draw SVG bezier connectors between them. The
  // overlay re-measures on: the raw ops / deps set changing, the grid
  // resizing (fonts load, responsive breakpoints), or cards scrolling
  // into view for the first time. All via ResizeObserver — React's
  // render phase can't know DOM measurements.
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const cardRefs = React.useRef<Map<string, HTMLElement>>(new Map())
  const [connectors, setConnectors] = React.useState<ConnectorLine[]>([])
  const [svgSize, setSvgSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })

  const depFingerprint = React.useMemo(
    () => dependencies.map((d) => `${d.id}:${d.predecessor_operation_id}->${d.successor_operation_id}:${d.link_strength}`).join('|'),
    [dependencies],
  )

  React.useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const compute = () => {
      const gridRect = grid.getBoundingClientRect()
      const scrollW = grid.scrollWidth
      const scrollH = grid.scrollHeight
      const next: ConnectorLine[] = []
      for (const dep of dependencies) {
        const fromEl = cardRefs.current.get(dep.predecessor_operation_id)
        const toEl = cardRefs.current.get(dep.successor_operation_id)
        if (!fromEl || !toEl) continue
        const fromRect = fromEl.getBoundingClientRect()
        const toRect = toEl.getBoundingClientRect()
        // Anchor points: right-middle of predecessor → left-middle of successor.
        const x1 = fromRect.right - gridRect.left + grid.scrollLeft
        const y1 = fromRect.top + fromRect.height / 2 - gridRect.top + grid.scrollTop
        const x2 = toRect.left - gridRect.left + grid.scrollLeft
        const y2 = toRect.top + toRect.height / 2 - gridRect.top + grid.scrollTop
        // Horizontal bezier — tight symmetric control points give a
        // smooth S-curve when ops at different vertical positions
        // connect across columns.
        const cx = (x1 + x2) / 2
        const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`
        next.push({ id: dep.id, d, strength: dep.link_strength })
      }
      setConnectors(next)
      setSvgSize({ w: scrollW, h: scrollH })
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(grid)
    for (const el of cardRefs.current.values()) observer.observe(el)
    return () => observer.disconnect()
  }, [depFingerprint, operations, dependencies])

  if (opsLoading || depsLoading) {
    return <LoadingMessage label={t('routing.flow.loading', 'Loading flow…')} />
  }
  if (opsError || depsError) {
    return (
      <p className="text-sm text-destructive">
        {t('routing.flow.loadError', 'Failed to load flow.')}
      </p>
    )
  }
  if (operations.length === 0) {
    return null
  }

  const hasAnyDependencies = dependencies.length > 0
  const levelsCount = Math.max(grouping.levels.length, 1)

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">
        {t('routing.flow.sectionTitle', 'Execution flow')}
      </h4>

      {!hasAnyDependencies ? (
        <Notice variant="info" compact>
          {t(
            'routing.flow.noDependencies',
            'No dependencies defined — operations will run in sequence order. Add dependencies to express parallel paths and convergence.',
          )}
        </Notice>
      ) : null}

      <div className="overflow-x-auto rounded-md border bg-muted/10 p-4">
        <div
          ref={gridRef}
          className="relative"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${levelsCount}, ${COLUMN_WIDTH}px)`,
            gap: `${ROW_GAP}px ${COLUMN_GAP}px`,
            alignItems: 'start',
          }}
        >
          {/* Column headers — one per level, placed in implicit row 1 of
              their column. Real op cards offset via gridRow: rowIndex+2. */}
          {grouping.levels.map((_opsAtLevel, levelIndex) => (
            <div
              key={`header-${levelIndex}`}
              style={{ gridColumn: levelIndex + 1, gridRow: 1 }}
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              {t('routing.flow.level.label', 'Level {n}').replace('{n}', String(levelIndex))}
              {_opsAtLevel.length > 1 ? (
                <span className="ml-2 text-muted-foreground/70">
                  {t('routing.flow.level.parallel', '({n} parallel)').replace('{n}', String(_opsAtLevel.length))}
                </span>
              ) : null}
            </div>
          ))}

          {grouping.levels.map((opsAtLevel, levelIndex) =>
            opsAtLevel.map((entry, rowIndex) => (
              <div
                key={entry.operation.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(entry.operation.id, el)
                  else cardRefs.current.delete(entry.operation.id)
                }}
                style={{ gridColumn: levelIndex + 1, gridRow: rowIndex + 2 }}
                className="relative z-10"
              >
                <OperationCard
                  operation={entry.operation}
                  workCenter={
                    entry.operation.work_center_id
                      ? workCentersById.get(entry.operation.work_center_id) ?? null
                      : null
                  }
                  intent="default"
                />
              </div>
            )),
          )}

          {/* SVG connector overlay — absolute-positioned to cover the
              full scrollable grid area. pointer-events: none so cards
              remain clickable underneath. aria-hidden because the
              dependency list already surfaces the same info textually. */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ width: svgSize.w, height: svgSize.h, zIndex: 0 }}
          >
            <defs>
              <marker
                id="routing-flow-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
              </marker>
            </defs>
            {connectors.map((line) => (
              <path
                key={line.id}
                d={line.d}
                fill="none"
                className="stroke-muted-foreground"
                strokeWidth={1.5}
                strokeDasharray={line.strength === 'optional' ? '4 3' : undefined}
                markerEnd="url(#routing-flow-arrow)"
              />
            ))}
          </svg>
        </div>
      </div>

      {grouping.unreachable.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="size-4" />
            {t('routing.flow.cycle.warning', 'Cycle detected — the following operations are unreachable in the flow')}
          </div>
          <div className="flex flex-wrap gap-2">
            {grouping.unreachable.map((op) => (
              <OperationCard
                key={op.id}
                operation={op}
                workCenter={op.work_center_id ? workCentersById.get(op.work_center_id) ?? null : null}
                intent="warning"
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single operation card — name, work center, run time.
// ---------------------------------------------------------------------------

type OperationCardProps = {
  operation: OperationRow
  workCenter: { name: string; code: string } | null
  intent: 'default' | 'warning'
}

function OperationCard({ operation, workCenter, intent }: OperationCardProps) {
  const t = useT()
  const runTimeLabel = formatRunTime(operation.run_time_minutes, t)
  const cardClass =
    intent === 'warning'
      ? 'rounded-md border border-amber-300 bg-white p-2 shadow-sm'
      : 'rounded-md border bg-card p-2 shadow-sm'
  return (
    <div className={cardClass}>
      <div className="text-sm font-medium truncate">
        <span className="text-muted-foreground">{operation.sequence}.</span>{' '}
        {operation.name || t('routing.common.placeholderDash', '—')}
      </div>
      <div className="mt-1 text-xs text-muted-foreground truncate">
        {workCenter ? <NameWithCode name={workCenter.name} code={workCenter.code} /> : (
          <span className="italic">{t('routing.flow.noWorkCenter', 'no work center')}</span>
        )}
      </div>
      <div className="text-xs font-mono">{runTimeLabel}</div>
    </div>
  )
}

function formatRunTime(value: string | null, t: (key: string, fallback: string) => string): string {
  if (value == null) return t('routing.flow.runTimeMissing', 'run time not set')
  const num = Number(value)
  if (!Number.isFinite(num)) return value
  const formatted = num.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return t('routing.flow.runTime', '{n} min').replace('{n}', formatted)
}
