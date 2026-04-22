'use client'

import * as React from 'react'
import { ChevronDown, ChevronRight, Calculator, AlertTriangle } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { VariantPicker } from '../../product_master/components/VariantPicker'
import ConfigurationForm from '../../configurator/components/ConfigurationForm'
import { useConfigAttributeKeys } from '../../configurator/components/useConfigAttributeKeys'
import { useOperationsForRouting } from '../hooks/useOperationsForRouting'
import { coerceSnapshotToStrings } from '../../../lib/variant-condition'

export type TimeRollupPanelProps = {
  routingTemplateId: string
  masterProductId: string
  // Intentionally narrow — mirrors the entity-level union on
  // CatalogProduct manufacturing extension. If upstream ever widens,
  // the boundary should adapt here too, not be permissive to string.
  configurationType: 'none' | 'variant_based' | 'rule_based'
}

type PerOperationResult = {
  operationId: string
  occupationMinutes: number
  leadTimeMinutes: number
}

type TimeRollupResult = {
  totalOccupationMinutes: number
  totalLeadTimeMinutes: number
  perOperation: PerOperationResult[]
  warnings: string[]
}

type RollupRequest = {
  quantity: number
  variantId: string | null
  variantConditions: Record<string, string>
}

/**
 * Time-rollup UI hosted inside a dialog opened from the routing tab
 * header — mirrors the BOM tab's Explode BOM dialog pattern. Calls
 * POST /api/routing/routing/time-rollup (the OM route tree nests
 * routing module under `/api/routing/` not `/api/manufacturing/`)
 * with quantity + the product-specific configuration input
 * (VariantPicker for variant_based, ConfigurationForm for rule_based,
 * nothing for none).
 *
 * Pure content — the caller is responsible for the Dialog wrapper and
 * should pass a fresh React `key` per dialog open so this component
 * remounts with clean state (no stale result, no stale picked
 * variant).
 */
export function TimeRollupPanel({
  routingTemplateId,
  masterProductId,
  configurationType,
}: TimeRollupPanelProps) {
  const t = useT()
  const [quantity, setQuantity] = React.useState<number>(1)
  const [pickedVariantId, setPickedVariantId] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<TimeRollupResult | null>(null)
  const [warningsOpen, setWarningsOpen] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `routing-time-rollup:${routingTemplateId}`,
  })

  const { rows: operations, isLoading: operationsLoading } = useOperationsForRouting(routingTemplateId)
  const operationsById = React.useMemo(() => {
    const map = new Map<string, (typeof operations)[number]>()
    for (const op of operations) map.set(op.id, op)
    return map
  }, [operations])

  // Rule-based attribute count — drives the "no configuration
  // attributes" edge case where we render a plain Calculate button
  // instead of the empty ConfigurationForm. Matches BOM explosion
  // panel's treatment.
  const { keys: ruleKeys, ready: ruleKeysReady } = useConfigAttributeKeys(
    configurationType === 'rule_based' ? masterProductId : undefined,
  )

  const runRollup = React.useCallback(
    async (request: RollupRequest) => {
      if (busy) return
      setBusy(true)
      setResult(null)
      try {
        // Wrap the compute POST in useGuardedMutation for parity with
        // BOM's explosion panel — record-lock injection + mutation
        // context propagates consistently across the manufacturing
        // panels even though this endpoint is read-compute, not a
        // write. Platform convention (packages/ui/AGENTS.md): every
        // POST/PUT/PATCH/DELETE runs through the guard.
        await runMutation({
          context: {
            entityId: 'routing:routing_template',
            operation: 'compute-time-rollup',
            formId: `routing-time-rollup:${routingTemplateId}`,
            routingTemplateId,
            retryLastMutation,
          },
          operation: async () => {
            const response = await apiCall<TimeRollupResult>(
              '/api/routing/routing/time-rollup',
              {
                method: 'POST',
                body: JSON.stringify({
                  routingTemplateId,
                  quantity: request.quantity,
                  variantId: request.variantId,
                  variantConditions: request.variantConditions,
                }),
              },
            )
            if (!response.ok) {
              throw new Error(t('routing.rollup.error.failed', 'Time rollup calculation failed.'))
            }
            setResult(response.result ?? null)
          },
        })
      } catch (err) {
        console.warn('[routing] time rollup failed', err)
        const msg = err instanceof Error && err.message.length > 0
          ? err.message
          : t('routing.rollup.error.failed', 'Time rollup calculation failed.')
        flash(msg, 'error')
      } finally {
        setBusy(false)
      }
    },
    [busy, retryLastMutation, routingTemplateId, runMutation, t],
  )

  const handleCalculateNoInput = React.useCallback(() => {
    void runRollup({ quantity, variantId: null, variantConditions: {} })
  }, [quantity, runRollup])

  const handleCalculateVariant = React.useCallback(() => {
    void runRollup({ quantity, variantId: pickedVariantId, variantConditions: {} })
  }, [quantity, pickedVariantId, runRollup])

  const handleCalculateRuleBased = React.useCallback(
    async (snapshot: Record<string, unknown>) => {
      // Step 1: resolve the snapshot via the configurator. Matches
      // BOM's explosion flow so any ConfigAttribute rules on the
      // master (computed / derived keys) are applied before we match
      // against OperationTemplateVariant.variant_condition downstream.
      // Skipping this step would miss overrides whose keys are
      // rule-produced rather than user-input.
      try {
        setBusy(true)
        const resolved = await readApiResultOrThrow<{
          resolvedConditions: Record<string, string>
          warnings?: string[]
          errors?: string[]
        }>(
          '/api/configurator/manufacturing/configurator/resolve',
          {
            method: 'POST',
            body: JSON.stringify({
              productId: masterProductId,
              configSnapshot: coerceSnapshotToStrings(snapshot),
            }),
          },
          { errorMessage: t('routing.rollup.error.resolve', 'Failed to resolve configuration.') },
        )
        await runRollup({
          quantity,
          variantId: null,
          variantConditions: resolved.resolvedConditions,
        })
      } catch (err) {
        const msg = err instanceof Error && err.message.length > 0
          ? err.message
          : t('routing.rollup.error.resolve', 'Failed to resolve configuration.')
        flash(msg, 'error')
      } finally {
        // runRollup toggles busy too — we only reach this finally if
        // the resolve step threw (runRollup never started). When
        // resolve succeeds, runRollup's own finally handles busy.
        setBusy(false)
      }
    },
    [masterProductId, quantity, runRollup, t],
  )

  const quantityField = (
    <div className="flex items-center gap-2">
      <Label htmlFor="routing-rollup-quantity" className="whitespace-nowrap">
        {t('routing.rollup.quantity', 'Quantity')}
      </Label>
      <Input
        id="routing-rollup-quantity"
        type="number"
        inputMode="numeric"
        min={1}
        value={quantity}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          setQuantity(Number.isFinite(n) && n >= 1 ? n : 1)
        }}
        disabled={busy}
        className="w-24"
      />
    </div>
  )

  let modeBlock: React.ReactNode = null
  if (configurationType === 'none') {
    modeBlock = (
      <div className="flex items-center justify-between gap-3">
        {quantityField}
        <Button type="button" onClick={handleCalculateNoInput} disabled={busy}>
          <Calculator className="mr-1 size-4" />
          {t('routing.rollup.submit', 'Calculate time')}
        </Button>
      </div>
    )
  } else if (configurationType === 'variant_based') {
    modeBlock = (
      <div className="space-y-3">
        <div className="flex items-center gap-4 flex-wrap">
          {quantityField}
          <div className="flex-1 min-w-[220px] space-y-1">
            <Label>{t('routing.rollup.variantPicker.label', 'Variant')}</Label>
            <VariantPicker
              productId={masterProductId}
              value={pickedVariantId}
              onChange={setPickedVariantId}
              disabled={busy}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            'routing.rollup.variantPicker.help',
            'Pick a variant to match OperationTemplateVariant overrides. Leave blank to calculate without overrides.',
          )}
        </p>
        <div className="flex justify-end">
          <Button type="button" onClick={handleCalculateVariant} disabled={busy}>
            <Calculator className="mr-1 size-4" />
            {t('routing.rollup.submit', 'Calculate time')}
          </Button>
        </div>
      </div>
    )
  } else if (configurationType === 'rule_based') {
    if (!ruleKeysReady) {
      // Attribute list still resolving — render a subdued loading row
      // so we don't flash an empty ConfigurationForm then swap it.
      modeBlock = (
        <LoadingMessage
          label={t('routing.rollup.loadingAttributes', 'Loading configuration…')}
        />
      )
    } else if (ruleKeys.length === 0) {
      // Rule-based master with no ConfigAttributes yet. Match BOM
      // explosion's edge-case treatment: render a bare Calculate
      // button + hint note so the user can still roll up the baseline
      // operations (any OperationTemplateVariant with a non-empty
      // variant_condition won't fire, but unconditional rows do).
      modeBlock = (
        <div className="space-y-3">
          {quantityField}
          <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t(
              'routing.rollup.ruleBased.noAttributes',
              'No configuration attributes defined — rollup will use base operation times only.',
            )}
          </p>
          <div className="flex justify-end">
            <Button type="button" onClick={handleCalculateNoInput} disabled={busy}>
              <Calculator className="mr-1 size-4" />
              {t('routing.rollup.submit', 'Calculate time')}
            </Button>
          </div>
        </div>
      )
    } else {
      modeBlock = (
        <div className="space-y-3">
          {quantityField}
          <ConfigurationForm
            productId={masterProductId}
            onSubmit={handleCalculateRuleBased}
            submitLabel={t('routing.rollup.submit', 'Calculate time')}
            disabled={busy}
          />
        </div>
      )
    }
  }

  return (
    <div className="space-y-4">
      {operationsLoading ? (
        <LoadingMessage label={t('routing.rollup.loadingOperations', 'Loading operations…')} />
      ) : operations.length === 0 ? (
        <Notice variant="info" compact>
          {t('routing.rollup.noOperations', 'Add at least one operation to calculate rollup.')}
        </Notice>
      ) : (
        <>
          {busy ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              <span>{t('routing.rollup.busy', 'Calculating…')}</span>
            </div>
          ) : null}
          {modeBlock}
          {result ? (
            <RollupResult
              result={result}
              operationsById={operationsById}
              warningsOpen={warningsOpen}
              setWarningsOpen={setWarningsOpen}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result display — totals + per-op breakdown + warnings disclosure
// ---------------------------------------------------------------------------

type RollupResultProps = {
  result: TimeRollupResult
  operationsById: ReadonlyMap<string, { id: string; name: string; sequence: number }>
  warningsOpen: boolean
  setWarningsOpen: (open: boolean) => void
}

function RollupResult({ result, operationsById, warningsOpen, setWarningsOpen }: RollupResultProps) {
  const t = useT()
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('routing.rollup.totalOccupation', 'Total occupation')}
          </div>
          <div className="mt-1 text-xl font-semibold font-mono">
            {formatMinutes(result.totalOccupationMinutes, t)}
          </div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('routing.rollup.totalLeadTime', 'Total lead time (critical path)')}
          </div>
          <div className="mt-1 text-xl font-semibold font-mono">
            {formatMinutes(result.totalLeadTimeMinutes, t)}
          </div>
        </div>
      </div>

      {result.perOperation.length > 0 ? (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full">
            <thead className="border-b bg-muted/30">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left">{t('routing.rollup.col.operation', 'Operation')}</th>
                <th className="px-3 py-2 text-right">{t('routing.rollup.col.occupation', 'Occupation')}</th>
                <th className="px-3 py-2 text-right">{t('routing.rollup.col.leadTime', 'Lead time')}</th>
              </tr>
            </thead>
            <tbody>
              {result.perOperation.map((row) => {
                const op = operationsById.get(row.operationId)
                return (
                  <tr key={row.operationId} className="border-b last:border-b-0">
                    <td className="px-3 py-1.5 text-sm">
                      {op ? (
                        <>
                          <span className="text-muted-foreground">{op.sequence}.</span>{' '}
                          {op.name}
                        </>
                      ) : (
                        row.operationId.slice(0, 8)
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-sm font-mono">
                      {formatMinutes(row.occupationMinutes, t)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-sm font-mono">
                      {formatMinutes(row.leadTimeMinutes, t)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50">
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-between px-3 py-2 text-amber-900 hover:bg-amber-100"
            onClick={() => setWarningsOpen(!warningsOpen)}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="size-4" />
              {t('routing.rollup.warnings.title', 'Warnings ({count})').replace('{count}', String(result.warnings.length))}
            </span>
            {warningsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
          {warningsOpen ? (
            <ul className="list-disc space-y-1 px-6 pb-3 text-xs text-amber-900">
              {result.warnings.map((warning, index) => (
                <li key={`${index}-${warning.slice(0, 20)}`}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function formatMinutes(value: number, t: (key: string, fallback: string) => string): string {
  if (!Number.isFinite(value)) return t('routing.common.placeholderDash', '—')
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return t('routing.rollup.minutesUnit', '{n} min').replace('{n}', formatted)
}
