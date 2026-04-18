'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { TagsInput, type TagsInputOption } from '@open-mercato/ui/backend/inputs/TagsInput'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  useConfigAttributeKeys,
  type ConfigAttributeMeta,
} from '../../configurator/components/useConfigAttributeKeys'
import {
  parseEditorRows,
  serializeEditorRows,
  type VariantConditionEditorRow,
  type VariantConditionValue,
} from '../lib/variant-condition-ui'

export type { VariantConditionValue } from '../lib/variant-condition-ui'

export type VariantConditionEditorProps = {
  value: VariantConditionValue
  onChange: (next: Record<string, string[] | { not: string[] }>) => void
  productId: string
  disabled?: boolean
}

type EditorRow = VariantConditionEditorRow

export function VariantConditionEditor({ value, onChange, productId, disabled }: VariantConditionEditorProps) {
  const t = useT()
  const { keys: scopeKeys, attributesByKey, ready: scopeReady } = useConfigAttributeKeys(productId)

  // Per-instance row-id allocator — avoids cross-instance collisions +
  // test-order dependence. Stable via useRef so allocating a new row never
  // re-renders.
  const rowCounterRef = React.useRef(0)
  const nextRowId = React.useCallback((): string => {
    rowCounterRef.current += 1
    return `row-${rowCounterRef.current}`
  }, [])

  // `value` owns the contract; `rows` is our UI-local expansion of it. We
  // only re-derive rows from `value` on the initial mount — subsequent
  // edits push through onChange without re-reading value (avoids focus
  // loss + lets the row editor state be authoritative mid-edit).
  const [rows, setRows] = React.useState<EditorRow[]>(() => parseEditorRows(value, nextRowId))

  // Keep rows in sync when the parent replaces value wholesale (e.g. opens
  // the dialog on a different BomLine). We detect "wholesale replace" by
  // comparing the canonical JSON of the outbound value to our internal
  // emit history. Initialize to the first-render value so the sync effect
  // does NOT fire on mount — which would reparse identical rows with
  // fresh rowIds and remount every child TagsInput / ComboboxInput (focus
  // loss + re-firing async loaders).
  const lastEmitted = React.useRef<string>(JSON.stringify(value ?? {}))
  const currentJson = React.useMemo(() => JSON.stringify(value ?? {}), [value])
  React.useEffect(() => {
    if (currentJson === lastEmitted.current) return
    lastEmitted.current = currentJson
    setRows(parseEditorRows(value, nextRowId))
  }, [currentJson, value, nextRowId])

  const emit = React.useCallback(
    (nextRows: EditorRow[]) => {
      const nextValue = serializeEditorRows(nextRows)
      lastEmitted.current = JSON.stringify(nextValue)
      onChange(nextValue)
    },
    [onChange],
  )

  // Updaters compute `next` in the handler closure (not inside setRows) —
  // setState updaters must be pure, and StrictMode double-invokes pure
  // updaters in dev. Computing outside lets us call emit exactly once per
  // user action without relying on microtask scheduling.
  const updateRow = React.useCallback(
    (rowId: string, patch: Partial<EditorRow>) => {
      const next = rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row))
      setRows(next)
      emit(next)
    },
    [rows, emit],
  )

  const addRow = React.useCallback(() => {
    // No emit — the new row's empty key is dropped by serializeEditorRows
    // so `value` wouldn't change. Emit fires once the user types a key or
    // adds values (via updateRow).
    setRows((prev) => [...prev, { rowId: nextRowId(), key: '', operator: 'in', values: [] }])
  }, [nextRowId])

  const removeRow = React.useCallback(
    (rowId: string) => {
      const next = rows.filter((row) => row.rowId !== rowId)
      setRows(next)
      emit(next)
    },
    [rows, emit],
  )

  const keySuggestions = React.useMemo<ComboboxOption[]>(
    () => scopeKeys.map((key) => ({ value: key, label: key })),
    [scopeKeys],
  )

  const emptyScope = scopeReady && scopeKeys.length === 0

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('bom.variantCondition.editor.empty', 'No conditions — line is always active.')}
        </p>
      ) : null}

      {rows.map((row) => {
        const meta = scopeReady ? attributesByKey.get(row.key) ?? null : null
        const unknown = scopeReady && row.key.trim().length > 0 && !meta
        return (
          <div key={row.rowId} className="flex flex-wrap items-start gap-2 rounded-md border bg-muted/20 p-2">
            <div className="min-w-[180px] flex-1">
              <ComboboxInput
                value={row.key}
                onChange={(next) => updateRow(row.rowId, { key: next })}
                placeholder={t('bom.variantCondition.editor.keyPlaceholder', 'Attribute key')}
                suggestions={keySuggestions}
                allowCustomValues
                disabled={disabled}
              />
              {unknown ? (
                <div className="mt-1">
                  <SimpleTooltip
                    content={t(
                      'bom.variantCondition.unknownKey.tooltip',
                      'Unknown key — matched against the consuming master\'s configuration at runtime.',
                    )}
                  >
                    <Badge variant="muted" className="cursor-help">
                      {t('bom.variantCondition.editor.unknownKeyBadge', 'Unknown key')}
                    </Badge>
                  </SimpleTooltip>
                </div>
              ) : null}
            </div>

            <OperatorToggle
              value={row.operator}
              onChange={(op) => updateRow(row.rowId, { operator: op })}
              disabled={disabled}
            />

            <div className="min-w-[240px] flex-[2]">
              <ValueCell
                attribute={meta}
                values={row.values}
                onChange={(values) => updateRow(row.rowId, { values })}
                disabled={disabled}
              />
            </div>

            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeRow(row.rowId)}
              disabled={disabled}
              aria-label={t('bom.variantCondition.editor.removeRow', 'Remove condition')}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        )
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        disabled={disabled}
      >
        <Plus className="size-4" />
        {t('bom.variantCondition.editor.addRow', 'Add condition')}
      </Button>

      {emptyScope && rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'bom.variantCondition.editor.emptyScopeHint',
            'This product has no configuration attributes — keys are matched against the consuming master at runtime.',
          )}
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Operator toggle — segmented two-button control (in / NOT in).
// ---------------------------------------------------------------------------

type OperatorToggleProps = {
  value: 'in' | 'not_in'
  onChange: (next: 'in' | 'not_in') => void
  disabled?: boolean
}

function OperatorToggle({ value, onChange, disabled }: OperatorToggleProps) {
  const t = useT()
  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      <Button
        type="button"
        variant={value === 'in' ? 'default' : 'ghost'}
        size="sm"
        className="h-8 rounded-none"
        onClick={() => onChange('in')}
        disabled={disabled}
      >
        {t('bom.variantCondition.operator.in', 'in')}
      </Button>
      <Button
        type="button"
        variant={value === 'not_in' ? 'default' : 'ghost'}
        size="sm"
        className="h-8 rounded-none"
        onClick={() => onChange('not_in')}
        disabled={disabled}
      >
        {t('bom.variantCondition.operator.notInShort', 'not in')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Value cell — dispatches to per-type renderer. TagsInput does the heavy
// lifting uniformly; type-specific configuration is limited to suggestions /
// loadSuggestions / resolveLabel / allowCustomValues.
// ---------------------------------------------------------------------------

type ValueCellProps = {
  attribute: ConfigAttributeMeta | null
  values: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

function ValueCell({ attribute, values, onChange, disabled }: ValueCellProps) {
  const t = useT()
  const attributeType = attribute?.attributeType ?? null

  if (attributeType === 'enum') {
    const allowed = extractEnumAllowedValues(attribute?.allowedValues)
    return (
      <TagsInput
        value={values}
        onChange={onChange}
        placeholder={t('bom.variantCondition.editor.valuesPlaceholder', 'Values')}
        suggestions={allowed.map((v) => ({ value: v, label: v }))}
        allowCustomValues={false}
        disabled={disabled}
      />
    )
  }

  if (attributeType === 'boolean') {
    return (
      <TagsInput
        value={values}
        onChange={onChange}
        placeholder={t('bom.variantCondition.editor.valuesPlaceholder', 'Values')}
        suggestions={[
          { value: 'true', label: t('bom.variantCondition.editor.boolean.true', 'true') },
          { value: 'false', label: t('bom.variantCondition.editor.boolean.false', 'false') },
        ]}
        allowCustomValues={false}
        disabled={disabled}
      />
    )
  }

  if (attributeType === 'numeric_range') {
    // allowedValues here is {min, max, step} — not a discrete option set.
    // For C1 the editor accepts free-text numeric entries; the per-range
    // builder UX lands in Phase D polish.
    return (
      <TagsInput
        value={values}
        onChange={onChange}
        placeholder={t('bom.variantCondition.editor.numericPlaceholder', 'e.g. 0-10')}
        allowCustomValues
        disabled={disabled}
      />
    )
  }

  if (attributeType === 'product') {
    return (
      <CatalogValueCell
        values={values}
        onChange={onChange}
        kind="product"
        categoryId={attribute?.productFilterId ?? null}
        disabled={disabled}
      />
    )
  }

  if (attributeType === 'product_variant') {
    return (
      <CatalogValueCell
        values={values}
        onChange={onChange}
        kind="product_variant"
        categoryId={attribute?.productFilterId ?? null}
        disabled={disabled}
      />
    )
  }

  // attribute_type === 'text' OR unknown key — free-text fallback. Same
  // renderer in both cases; the editor's "unknown key" warning badge on
  // the key cell signals the difference.
  return (
    <TagsInput
      value={values}
      onChange={onChange}
      placeholder={t('bom.variantCondition.editor.valuesPlaceholder', 'Values')}
      allowCustomValues
      disabled={disabled}
    />
  )
}

function extractEnumAllowedValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

// ---------------------------------------------------------------------------
// Catalog value cell — TagsInput with lazy-loaded suggestions scoped by the
// ConfigAttribute's product_filter_id category. For `product_variant`, we
// first load products in the category, then flatten their variants into a
// single suggestion list. Bounded by category size (typically 1-50 products)
// so a one-shot load is fine; search is client-side over the cached set.
// ---------------------------------------------------------------------------

type CatalogKind = 'product' | 'product_variant'

type CatalogValueCellProps = {
  values: string[]
  onChange: (next: string[]) => void
  kind: CatalogKind
  categoryId: string | null
  disabled?: boolean
}

type CatalogOptionCache = { options: TagsInputOption[] }

function CatalogValueCell({ values, onChange, kind, categoryId, disabled }: CatalogValueCellProps) {
  const t = useT()
  const cacheRef = React.useRef<CatalogOptionCache | null>(null)

  // Wrapped in try/catch because TagsInput.loadSuggestions doesn't catch
  // rejections (see TagsInput.tsx) — a 403 (missing catalog.products.view)
  // or network blip would otherwise surface as an unhandled rejection.
  // Graceful degradation: show an empty suggestion list, user can still
  // type UUIDs manually (allowCustomValues happens to be false here, so
  // the practical fallback is "no options" — acceptable for Phase C).
  const loadAll = React.useCallback(async (): Promise<TagsInputOption[]> => {
    if (cacheRef.current) return cacheRef.current.options

    try {
      if (kind === 'product') {
        const url = categoryId
          ? `/api/catalog/products?categoryIds=${encodeURIComponent(categoryId)}&pageSize=100`
          : `/api/catalog/products?pageSize=100`
        const data = await readApiResultOrThrow<{ items?: Array<{ id?: string; title?: string | null }> }>(
          url,
          undefined,
          { errorMessage: 'catalog products fetch failed' },
        )
        const options: TagsInputOption[] = (data?.items ?? [])
          .filter((item): item is { id: string; title?: string | null } => typeof item.id === 'string')
          .map((item) => ({
            value: item.id,
            label: typeof item.title === 'string' && item.title.length > 0 ? item.title : item.id,
          }))
        cacheRef.current = { options }
        return options
      }

      // kind === 'product_variant' — fetch products in the category, then
      // their variants. For categoryId=null we fall back to a flat variants
      // list (first page) — edge case when the attribute is missing its filter.
      const productsData = categoryId
        ? await readApiResultOrThrow<{ items?: Array<{ id?: string }> }>(
            `/api/catalog/products?categoryIds=${encodeURIComponent(categoryId)}&pageSize=100`,
            undefined,
            { errorMessage: 'catalog products fetch failed' },
          )
        : { items: [] as Array<{ id?: string }> }
      const productIds = (productsData?.items ?? [])
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string')

      let variantItems: Array<{ id?: string; name?: string | null; product_id?: string | null }> = []
      if (productIds.length === 0 && !categoryId) {
        const data = await readApiResultOrThrow<{ items?: typeof variantItems }>(
          `/api/catalog/variants?pageSize=100`,
          undefined,
          { errorMessage: 'catalog variants fetch failed' },
        )
        variantItems = data?.items ?? []
      } else {
        const perProduct = await Promise.all(
          productIds.map((pid) =>
            readApiResultOrThrow<{ items?: typeof variantItems }>(
              `/api/catalog/variants?productId=${encodeURIComponent(pid)}&pageSize=100`,
              undefined,
              { errorMessage: 'catalog variants fetch failed' },
            ).then((data) => data?.items ?? []),
          ),
        )
        variantItems = perProduct.flat()
      }

      const options: TagsInputOption[] = variantItems
        .filter((item): item is { id: string; name?: string | null; product_id?: string | null } => typeof item.id === 'string')
        .map((item) => ({
          value: item.id,
          label: typeof item.name === 'string' && item.name.length > 0 ? item.name : item.id,
        }))
      cacheRef.current = { options }
      return options
    } catch (err) {
      console.warn('[bom] VariantConditionEditor catalog value load failed', err)
      return []
    }
  }, [kind, categoryId])

  const loadSuggestions = React.useCallback(
    async (query?: string): Promise<TagsInputOption[]> => {
      const all = await loadAll()
      if (!query) return all
      const q = query.toLowerCase()
      return all.filter((opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q))
    },
    [loadAll],
  )

  const resolveLabel = React.useCallback(
    (uuid: string) => {
      if (!cacheRef.current) return uuid
      const hit = cacheRef.current.options.find((opt) => opt.value === uuid)
      return hit?.label ?? uuid
    },
    [],
  )

  return (
    <TagsInput
      value={values}
      onChange={onChange}
      placeholder={
        kind === 'product'
          ? t('bom.variantCondition.editor.productPlaceholder', 'Pick products')
          : t('bom.variantCondition.editor.productVariantPlaceholder', 'Pick product variants')
      }
      loadSuggestions={loadSuggestions}
      resolveLabel={resolveLabel}
      allowCustomValues={false}
      showSuggestionsOnFocus
      disabled={disabled}
    />
  )
}
