'use client'

import * as React from 'react'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { DatePicker } from '@open-mercato/ui/backend/inputs/DatePicker'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  apiCall,
  readApiResultOrThrow,
} from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import ConfigurationForm from '../../configurator/components/ConfigurationForm'
import { useConfigAttributeKeys } from '../../configurator/components/useConfigAttributeKeys'
import { VariantPicker } from '../../product_master/components/VariantPicker'
import { useCatalogLookup } from '../hooks/useCatalogLookup'
import { useUomLookup } from '../hooks/useUomLookup'
import type { BomTabExtension } from './BomTab'

// ---------------------------------------------------------------------------
// Types — mirror the worker's resultSummary contract (spec b §Output). Kept
// local so the panel does not import from bom-explosion.ts (server-only).
// ---------------------------------------------------------------------------

type ExplosionLine = {
  bomLineId: string
  productId: string | null
  productVariantId: string | null
  quantity: number
  uomId: string | null
  scrapPercentage: number
  grossQuantity: number
  operationTemplateId: string | null
  level: number
  isPhantomPassThrough: boolean
  sourceBomHeaderId: string
  isConsumable: boolean
}

type ExplosionWarning = {
  bomLineId: string | null
  message: string
}

type ExplosionSummary = {
  lines: ExplosionLine[]
  warnings: ExplosionWarning[]
  depth: number
  lineCount: number
}

type BomLineMeta = {
  id: string
  product_resolve_key: string | null
}

export type BomExplosionPanelProps = {
  productId: string
  bomHeaderId: string
  extension: BomTabExtension
}

type Mode = 'none' | 'variant_based' | 'rule_based'

const POLL_INTERVAL_MS = 400
const POLL_TIMEOUT_MS = 30_000

// Coerce a raw ConfigurationForm snapshot value into the string shape the
// configurator resolve endpoint expects. Spec d: boolean → 'true'/'false',
// number → decimal string, string → unchanged, anything else → empty (skip).
function coerceSnapshotToStrings(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue
    if (typeof value === 'string') {
      if (value.length > 0) out[key] = value
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      out[key] = String(value)
    }
  }
  return out
}

export function BomExplosionPanel({ productId, bomHeaderId, extension }: BomExplosionPanelProps) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'bom-explosion-panel',
  })

  const mode = (extension.configurationType as Mode) ?? 'none'
  const [effectiveDate, setEffectiveDate] = React.useState<Date | null>(new Date())
  const [pickedVariantId, setPickedVariantId] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ExplosionSummary | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [warningsOpen, setWarningsOpen] = React.useState(true)

  // Unmount flag so the polling loop can bail out silently when the dialog
  // closes (the parent key-rotates this panel on each open). Spec §7 allows
  // polling as an acceptable fallback to the DOM Event Bridge (useOperationProgress
  // path) which currently has no SSE feed wired for bom.explosion.completed.
  // Without this cleanup the loop would keep polling up to POLL_TIMEOUT_MS
  // after unmount.
  const cancelledRef = React.useRef(false)
  React.useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // Rule-based attribute count — drives the "no configuration attributes" edge
  // case where we render a plain Explode button instead of the form.
  const { keys: ruleKeys, ready: ruleKeysReady } = useConfigAttributeKeys(
    mode === 'rule_based' ? productId : undefined,
  )

  // Core submit flow — enqueues the explosion and polls progress until the
  // worker writes resultSummary. Shared across all three modes; each mode
  // prepares the payload shape differently and then calls here.
  const enqueueAndWait = React.useCallback(
    async (payload: { variantConditions: Record<string, string>; variantId: string | null }) => {
      const enqueue = await apiCall<{ jobId?: string }>('/api/bom/bom/explode', {
        method: 'POST',
        body: JSON.stringify({
          bomHeaderId,
          variantConditions: payload.variantConditions,
          variantId: payload.variantId,
          effectiveDate: effectiveDate ? effectiveDate.toISOString() : undefined,
        }),
      })
      if (!enqueue.ok || !enqueue.result?.jobId) {
        const err =
          (enqueue.result as { error?: string } | null | undefined)?.error ??
          t('bom.explosion.error.enqueue', 'Failed to queue explosion.')
        throw new Error(err)
      }
      const jobId = enqueue.result.jobId
      const deadline = Date.now() + POLL_TIMEOUT_MS
      // Poll cadence: short initial delay keeps fast local-queue jobs snappy;
      // thereafter POLL_INTERVAL_MS matches the integration-test helper so
      // jobs complete in 1–3 polls in dev. cancelledRef short-circuits each
      // iteration so a mid-flight dialog close stops the loop immediately.
      await new Promise((r) => setTimeout(r, 50))
      while (Date.now() < deadline) {
        if (cancelledRef.current) return
        const poll = await apiCall<{
          status: string
          resultSummary?: Record<string, unknown>
          errorMessage?: string | null
        }>(`/api/progress/jobs/${encodeURIComponent(jobId)}`)
        if (cancelledRef.current) return
        if (!poll.ok) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
          continue
        }
        const job = poll.result
        if (!job) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
          continue
        }
        if (job.status === 'completed') {
          if (cancelledRef.current) return
          setResult((job.resultSummary ?? {}) as ExplosionSummary)
          return
        }
        if (job.status === 'failed') {
          throw new Error(
            job.errorMessage ??
              t('bom.explosion.error.failed', 'Explosion worker reported failure.'),
          )
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
      if (cancelledRef.current) return
      throw new Error(t('bom.explosion.error.timeout', 'Explosion timed out.'))
    },
    [bomHeaderId, effectiveDate, t],
  )

  const runExplosion = React.useCallback(
    async (variantConditions: Record<string, string>, variantId: string | null) => {
      if (busy) return
      setBusy(true)
      try {
        await runMutation({
          context: {
            entityId: 'bom:bom_header',
            operation: 'explode',
            retryLastMutation,
          },
          operation: async () => {
            await enqueueAndWait({ variantConditions, variantId })
          },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        flash(msg, 'error')
      } finally {
        setBusy(false)
      }
    },
    [busy, enqueueAndWait, retryLastMutation, runMutation],
  )

  // --- Mode handlers ---------------------------------------------------------

  const handleExplodeNoInput = React.useCallback(() => {
    runExplosion({}, null)
  }, [runExplosion])

  const handleExplodeVariant = React.useCallback(() => {
    runExplosion({}, pickedVariantId)
  }, [pickedVariantId, runExplosion])

  const handleExplodeRuleBased = React.useCallback(
    async (snapshot: Record<string, unknown>) => {
      if (busy) return
      setBusy(true)
      try {
        await runMutation({
          context: {
            entityId: 'bom:bom_header',
            operation: 'explode',
            retryLastMutation,
          },
          operation: async () => {
            // Step 1: resolve the snapshot via the configurator. The resolve
            // endpoint is a pure-function wrapper that applies constraint
            // rules (when defined) and returns the conditions map that drives
            // both BomLine filtering (Step 1) and dynamic product resolution
            // (Step 2) inside the explosion worker.
            const resolved = await readApiResultOrThrow<{
              resolvedConditions: Record<string, string>
              warnings?: string[]
              errors?: string[]
            }>(
              '/api/configurator/manufacturing/configurator/resolve',
              {
                method: 'POST',
                body: JSON.stringify({
                  productId,
                  configSnapshot: coerceSnapshotToStrings(snapshot),
                }),
              },
              { errorMessage: t('bom.explosion.error.resolve', 'Failed to resolve configuration.') },
            )
            await enqueueAndWait({
              variantConditions: resolved.resolvedConditions,
              variantId: null,
            })
          },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        flash(msg, 'error')
      } finally {
        setBusy(false)
      }
    },
    [busy, enqueueAndWait, productId, retryLastMutation, runMutation, t],
  )

  // --- Input area ------------------------------------------------------------

  const dateField = (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-foreground">
        {t('bom.explosion.effectiveDate', 'Effective date')}
      </label>
      <div className="w-56">
        <DatePicker
          value={effectiveDate}
          onChange={setEffectiveDate}
          placeholder={t('bom.explosion.effectiveDate.placeholder', 'Pick a date')}
          disabled={busy}
        />
      </div>
    </div>
  )

  let modeBlock: React.ReactNode = null
  if (mode === 'none') {
    modeBlock = (
      <div className="flex items-center justify-between gap-3">
        {dateField}
        <Button type="button" onClick={handleExplodeNoInput} disabled={busy}>
          {t('bom.explosion.submit', 'Explode BOM')}
        </Button>
      </div>
    )
  } else if (mode === 'variant_based') {
    modeBlock = (
      <div className="space-y-3">
        {dateField}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            {t('bom.explosion.variantPicker.label', 'Variant')}
          </label>
          <VariantPicker
            productId={productId}
            value={pickedVariantId}
            onChange={setPickedVariantId}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            {t(
              'bom.explosion.variantPicker.help',
              'Pick a variant to match BomLineVariant overrides. Leave blank to explode without overrides.',
            )}
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={handleExplodeVariant} disabled={busy}>
            {t('bom.explosion.submit', 'Explode BOM')}
          </Button>
        </div>
      </div>
    )
  } else if (mode === 'rule_based') {
    if (!ruleKeysReady) {
      modeBlock = (
        <LoadingMessage label={t('bom.explosion.loadingAttributes', 'Loading configuration…')} />
      )
    } else if (ruleKeys.length === 0) {
      // Rule-based master with no ConfigAttributes yet — spec §7 edge case.
      // Bare button + note; explosion runs with empty conditions so only
      // unconditional BomLines survive (conditional ones are skipped with a
      // post-run warning).
      modeBlock = (
        <div className="space-y-3">
          {dateField}
          <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t(
              'bom.explosion.ruleBased.noAttributes',
              'No configuration attributes defined — explosion will include only unconditional BOM lines.',
            )}
          </p>
          <div className="flex justify-end">
            <Button type="button" onClick={handleExplodeNoInput} disabled={busy}>
              {t('bom.explosion.submit', 'Explode BOM')}
            </Button>
          </div>
        </div>
      )
    } else {
      modeBlock = (
        <div className="space-y-4">
          {dateField}
          <ConfigurationForm
            productId={productId}
            onSubmit={handleExplodeRuleBased}
            submitLabel={t('bom.explosion.submit', 'Explode BOM')}
            disabled={busy}
          />
        </div>
      )
    }
  }

  return (
    <div className="space-y-4">
      {busy ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner size="sm" />
          <span>{t('bom.explosion.busy', 'Exploding…')}</span>
        </div>
      ) : null}

      {modeBlock}

      {result ? (
        <ExplosionResult
          result={result}
          warningsOpen={warningsOpen}
          setWarningsOpen={setWarningsOpen}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result display — flat line list + Resolution column + collapsible warnings.
// Lines with productId=null that had a master product_resolve_key render in a
// muted row with a "Not in planning" badge (spec b §7 result contract).
// ---------------------------------------------------------------------------

function ExplosionResult({
  result,
  warningsOpen,
  setWarningsOpen,
}: {
  result: ExplosionSummary
  warningsOpen: boolean
  setWarningsOpen: (next: boolean) => void
}) {
  const t = useT()

  // Fetch master BomLine.product_resolve_key for every bomLineId in the
  // result so we can compute the Resolution column without a dedicated
  // status field on ExplosionLine (spec b §7 — column derived from the
  // (productId, master resolve_key) pair).
  const bomLineIds = React.useMemo(
    () => Array.from(new Set(result.lines.map((l) => l.bomLineId))),
    [result.lines],
  )
  const resolveKeyByLineId = useBomLineResolveKeys(bomLineIds)

  // UUID → display name for Product + ProductVariant. Reuses the same batch
  // lookup hook that drives VariantConditionBadges so catalog requests share
  // React Query cache across the page.
  const productIds = React.useMemo(
    () => result.lines.map((l) => l.productId).filter((v): v is string => typeof v === 'string'),
    [result.lines],
  )
  const variantIds = React.useMemo(
    () =>
      result.lines.map((l) => l.productVariantId).filter((v): v is string => typeof v === 'string'),
    [result.lines],
  )
  const { productsById, variantsById } = useCatalogLookup(productIds, variantIds)

  const uomIds = React.useMemo(
    () => result.lines.map((l) => l.uomId).filter((v): v is string => typeof v === 'string'),
    [result.lines],
  )
  const uomsById = useUomLookup(uomIds)

  if (result.lines.length === 0 && result.warnings.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/40 px-3 py-6 text-center text-xs text-muted-foreground">
        {t('bom.explosion.empty', 'No lines in this BOM.')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-2 py-2 font-medium">
                {t('bom.explosion.col.resolution', 'Resolution')}
              </th>
              <th className="px-2 py-2 font-medium">
                {t('bom.explosion.col.product', 'Product')}
              </th>
              <th className="px-2 py-2 font-medium text-right">
                {t('bom.explosion.col.quantity', 'Qty')}
              </th>
              <th className="px-2 py-2 font-medium">
                {t('bom.explosion.col.uom', 'UoM')}
              </th>
              <th className="px-2 py-2 font-medium text-right">
                {t('bom.explosion.col.gross', 'Gross')}
              </th>
              <th className="px-2 py-2 font-medium text-right">
                {t('bom.explosion.col.level', 'Level')}
              </th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((line, index) => {
              const resolveKey = resolveKeyByLineId.get(line.bomLineId) ?? null
              const resolution = computeResolution(line.productId, resolveKey)
              const muted = resolution.kind === 'unresolved'
              const productName = line.productId
                ? productsById.get(line.productId)?.title ?? line.productId
                : null
              const variantName = line.productVariantId
                ? variantsById.get(line.productVariantId)?.name ?? line.productVariantId
                : null
              const uomCode = line.uomId ? uomsById.get(line.uomId)?.code ?? line.uomId : null
              return (
                <tr
                  key={`${line.bomLineId}-${index}`}
                  className={muted ? 'text-muted-foreground opacity-70' : ''}
                >
                  <td className="px-2 py-1.5 align-top">
                    <ResolutionBadge resolution={resolution} />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    {productName ? (
                      <span>
                        {productName}
                        {variantName ? (
                          <span className="text-muted-foreground"> · {variantName}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="italic">
                        {t('bom.explosion.col.product.unresolved', 'Not in planning')}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-top text-right tabular-nums">
                    {line.quantity.toFixed(4).replace(/\.?0+$/, '')}
                  </td>
                  <td className="px-2 py-1.5 align-top">{uomCode ?? '—'}</td>
                  <td className="px-2 py-1.5 align-top text-right tabular-nums">
                    {line.grossQuantity.toFixed(4).replace(/\.?0+$/, '')}
                  </td>
                  <td className="px-2 py-1.5 align-top text-right tabular-nums">
                    {line.level}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {result.warnings.length > 0 ? (
        <div className="rounded-md border">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setWarningsOpen(!warningsOpen)}
            className="h-auto w-full justify-start gap-2 px-3 py-2 text-xs font-medium"
          >
            {warningsOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <AlertTriangle className="size-3.5 text-amber-600" />
            <span>
              {t('bom.explosion.warnings.title', 'Warnings')} ({result.warnings.length})
            </span>
          </Button>
          {warningsOpen ? (
            <ul className="space-y-1 border-t px-3 py-2 text-xs">
              {result.warnings.map((w, i) => (
                <li key={i} className="text-muted-foreground">
                  <span className="text-foreground">•</span> {w.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resolution column derivation — spec b §7: computed in the UI, no dedicated
// status field on ExplosionLine.
// ---------------------------------------------------------------------------

type Resolution =
  | { kind: 'static' }
  | { kind: 'resolved'; key: string }
  | { kind: 'unresolved'; key: string }

function computeResolution(productId: string | null, resolveKey: string | null): Resolution {
  if (resolveKey) {
    return productId ? { kind: 'resolved', key: resolveKey } : { kind: 'unresolved', key: resolveKey }
  }
  return { kind: 'static' }
}

function ResolutionBadge({ resolution }: { resolution: Resolution }) {
  const t = useT()
  if (resolution.kind === 'static') {
    return (
      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium">
        {t('bom.explosion.resolution.static', 'static')}
      </span>
    )
  }
  if (resolution.kind === 'resolved') {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[0.65rem] font-medium text-emerald-900">
        {t('bom.explosion.resolution.resolved', 'resolved')}
        <span className="ml-1 text-emerald-700">· {resolution.key}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[0.65rem] font-medium text-amber-900">
      {t('bom.explosion.resolution.unresolved', 'unresolved')}
      <span className="ml-1 text-amber-700">· {resolution.key}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// BomLine.product_resolve_key lookup — fetch the master BomLines referenced
// by the explosion output so the UI can compute the Resolution column
// without a dedicated output-contract field.
// ---------------------------------------------------------------------------

function useBomLineResolveKeys(bomLineIds: readonly string[]): ReadonlyMap<string, string | null> {
  const [map, setMap] = React.useState<ReadonlyMap<string, string | null>>(new Map())

  const signature = React.useMemo(() => {
    if (bomLineIds.length === 0) return ''
    return [...new Set(bomLineIds)].sort().join(',')
  }, [bomLineIds])

  React.useEffect(() => {
    if (!signature) {
      setMap(new Map())
      return
    }
    let cancelled = false
    const ids = signature.split(',')
    // Catalog endpoints cap pageSize at 100; bom-line uses the same factory,
    // so chunking isn't necessary for typical BOMs. A single BOM is unlikely
    // to exceed 100 unique bomLineIds in its explosion output.
    readApiResultOrThrow<{ items?: BomLineMeta[] }>(
      `/api/bom/bom-line?ids=${encodeURIComponent(ids.join(','))}&pageSize=${Math.max(ids.length, 1)}`,
      undefined,
      { errorMessage: 'bom line resolve-key batch fetch failed' },
    )
      .then((data) => {
        if (cancelled) return
        const out = new Map<string, string | null>()
        for (const item of data?.items ?? []) {
          if (typeof item.id === 'string') {
            out.set(item.id, item.product_resolve_key ?? null)
          }
        }
        setMap(out)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[bom] useBomLineResolveKeys: fetch failed', err)
        setMap(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [signature])

  return map
}

export default BomExplosionPanel
