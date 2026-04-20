'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
  type CrudCustomFieldRenderProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useWorkCenterSearch } from '../hooks/useWorkCenterSearch'
import { useWorkCenterLookup } from '../hooks/useWorkCenterLookup'
import { WorkCenterQuickCreateDialog } from './WorkCenterQuickCreateDialog'
import {
  OPERATION_DEFAULT_VALUES,
  buildCreatePayload,
  buildUpdatePayload,
  operationRowToFormValues,
  type OperationFormValues,
} from './OperationTemplateFormConfig'
import type { OperationRow } from '../hooks/useOperationsForRouting'

const PAYMENT_TYPES = ['hourly', 'piecework', 'base_plus_piecework'] as const

export type OperationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  routingTemplateId: string
  editingOperation: OperationRow | null
  onSuccess: () => void
}

export function OperationDialog({
  open,
  onOpenChange,
  routingTemplateId,
  editingOperation,
  onSuccess,
}: OperationDialogProps) {
  const t = useT()

  const initialValues = React.useMemo<OperationFormValues>(
    () => (editingOperation ? operationRowToFormValues(editingOperation) : OPERATION_DEFAULT_VALUES),
    [editingOperation],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'name',
        label: t('routing.operation.form.name', 'Name'),
        type: 'text',
        required: true,
        placeholder: t('routing.operation.form.namePlaceholder', 'e.g. Foam lamination'),
      },
      {
        id: 'workCenterId',
        label: t('routing.operation.form.workCenter', 'Work center'),
        type: 'custom',
        component: (props) => <WorkCenterPickerField {...props} />,
      },
      {
        id: 'setupTimeMinutes',
        label: t('routing.operation.form.setupTime', 'Setup time (min)'),
        type: 'number',
        placeholder: t('routing.operation.form.timePlaceholder', '0.00'),
      },
      {
        id: 'runTimeMinutes',
        label: t('routing.operation.form.runTime', 'Run time per unit (min)'),
        type: 'number',
        placeholder: t('routing.operation.form.timePlaceholder', '0.00'),
      },
      {
        id: 'teardownTimeMinutes',
        label: t('routing.operation.form.teardownTime', 'Teardown time (min)'),
        type: 'number',
        placeholder: t('routing.operation.form.timePlaceholder', '0.00'),
      },
      {
        id: 'waitTimeMinutes',
        label: t('routing.operation.form.waitTime', 'Wait time (min)'),
        type: 'number',
        placeholder: t('routing.operation.form.timePlaceholder', '0.00'),
      },
      {
        id: 'moveTimeMinutes',
        label: t('routing.operation.form.moveTime', 'Move time (min)'),
        type: 'number',
        placeholder: t('routing.operation.form.timePlaceholder', '0.00'),
      },
      {
        id: 'paymentType',
        label: t('routing.operation.form.paymentType', 'Payment type'),
        type: 'select',
        options: [
          { value: 'hourly', label: t('routing.operation.paymentType.hourly', 'Hourly') },
          { value: 'piecework', label: t('routing.operation.paymentType.piecework', 'Piecework') },
          { value: 'base_plus_piecework', label: t('routing.operation.paymentType.base_plus_piecework', 'Base + piecework') },
        ],
      },
      {
        id: 'hourlyRate',
        label: t('routing.operation.form.hourlyRate', 'Hourly rate'),
        type: 'custom',
        component: (props) => <RateReactiveField {...props} activeFor={['hourly', 'base_plus_piecework']} />,
      },
      {
        id: 'pieceworkRate',
        label: t('routing.operation.form.pieceworkRate', 'Piece rate'),
        type: 'custom',
        component: (props) => <RateReactiveField {...props} activeFor={['piecework', 'base_plus_piecework']} />,
      },
      {
        id: 'isSubcontracted',
        label: t('routing.operation.form.isSubcontracted', 'Subcontracted'),
        type: 'checkbox',
      },
      {
        id: 'notes',
        label: t('routing.operation.form.notes', 'Notes'),
        type: 'textarea',
      },
    ],
    [t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'identity',
        title: t('routing.operation.form.group.identity', 'Operation'),
        fields: ['name', 'workCenterId'],
      },
      {
        id: 'times',
        title: t('routing.operation.form.group.times', 'Time components'),
        fields: ['setupTimeMinutes', 'runTimeMinutes', 'teardownTimeMinutes', 'waitTimeMinutes', 'moveTimeMinutes'],
      },
      {
        id: 'payment',
        title: t('routing.operation.form.group.payment', 'Payment'),
        fields: ['paymentType', 'hourlyRate', 'pieceworkRate'],
      },
      {
        id: 'flags',
        title: t('routing.operation.form.group.flags', 'Flags'),
        fields: ['isSubcontracted'],
      },
      {
        id: 'notes',
        title: t('routing.operation.form.group.notes', 'Notes'),
        fields: ['notes'],
      },
    ],
    [t],
  )

  const handleSubmit = React.useCallback(
    async (values: OperationFormValues) => {
      if (editingOperation) {
        await updateCrud('routing/operation', buildUpdatePayload(values, editingOperation.id))
        flash(t('routing.operation.flash.updated', 'Operation updated.'), 'success')
      } else {
        await createCrud('routing/operation', buildCreatePayload(values, routingTemplateId))
        flash(t('routing.operation.flash.created', 'Operation created.'), 'success')
      }
      onSuccess()
    },
    [editingOperation, onSuccess, routingTemplateId, t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingOperation
              ? t('routing.operation.dialog.editTitle', 'Edit operation')
              : t('routing.operation.dialog.createTitle', 'Add operation')}
          </DialogTitle>
        </DialogHeader>
        <CrudForm<OperationFormValues>
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={
            editingOperation
              ? t('routing.operation.dialog.submitUpdate', 'Save changes')
              : t('routing.operation.dialog.submitCreate', 'Add operation')
          }
          embedded
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Custom field: Work center picker with inline "create new" shortcut
// ---------------------------------------------------------------------------

function WorkCenterPickerField({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const { options, isLoading, isError, invalidate: invalidateSearch } = useWorkCenterSearch()
  const [createOpen, setCreateOpen] = React.useState(false)
  const current = typeof value === 'string' ? value : ''

  // Belt-and-braces label resolution: search is filtered to active WCs, so
  // if the currently-saved WC is inactive or soft-deleted, resolve it via
  // lookup-by-id instead. Falls back to raw id if neither source has it.
  const lookupIds = current ? [current] : []
  const wcsById = useWorkCenterLookup(lookupIds)

  const suggestions: ComboboxOption[] = options.map((wc) => ({
    value: wc.id,
    label: wc.name,
    description: wc.code || undefined,
  }))

  const resolveLabel = (id: string) => {
    // Prefer the active-search result — it was just refetched for the
    // picker list and reflects the freshest state. Fall back to the
    // lookup (useful for inactive/soft-deleted WCs that the search
    // filter excludes), and finally to the raw id.
    const fromSearch = options.find((wc) => wc.id === id)
    const fromLookup = wcsById.get(id)
    return fromSearch?.name || fromLookup?.name || id
  }

  const handleCreateSuccess = React.useCallback(
    (created: { id: string }) => {
      setValue(created.id)
      // Force the dropdown's search list to refetch so the new WC is
      // visible for subsequent picks; otherwise the user can't pick the
      // same WC for a second operation in this session until the
      // focus-refetch or staleTime window elapses.
      invalidateSearch()
      setCreateOpen(false)
    },
    [invalidateSearch, setValue],
  )

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <ComboboxInput
            value={current}
            onChange={setValue}
            placeholder={t('routing.operation.form.workCenterPlaceholder', 'Pick a work center')}
            suggestions={suggestions}
            resolveLabel={resolveLabel}
            allowCustomValues={false}
            disabled={disabled}
          />
        </div>
        <SimpleTooltip content={t('routing.operation.form.workCenterCreateTooltip', 'Create a work center without leaving the dialog.')}>
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={disabled}
            aria-label={t('routing.operation.form.workCenterCreate', 'Create work center')}
          >
            <Plus className="size-4" />
          </IconButton>
        </SimpleTooltip>
      </div>
      {isLoading && options.length === 0 && !isError ? (
        <p className="text-xs text-muted-foreground">
          {t('routing.operation.form.loading', 'Loading…')}
        </p>
      ) : null}
      {isError ? (
        <Notice variant="error" compact>
          {t('routing.operation.form.fetchFailed', 'Failed to load options — check your connection and retry.')}
        </Notice>
      ) : null}
      <WorkCenterQuickCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={handleCreateSuccess}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom field: Rate input that self-hides unless the current payment_type
// includes this rate flavor. Replaces two separate visibility props on the
// CrudField by reading paymentType from CrudForm's `values`.
// ---------------------------------------------------------------------------

type RateReactiveFieldProps = CrudCustomFieldRenderProps & {
  activeFor: ReadonlyArray<(typeof PAYMENT_TYPES)[number]>
}

function RateReactiveField({ value, setValue, values, disabled, activeFor }: RateReactiveFieldProps) {
  const t = useT()
  // Honest narrowing: check membership before casting. Unknown payment
  // types fall through to the inactive branch (which shows the "not
  // applicable" placeholder rather than rendering a broken input).
  const rawPaymentType = values?.paymentType
  const paymentType = typeof rawPaymentType === 'string' && (PAYMENT_TYPES as readonly string[]).includes(rawPaymentType)
    ? (rawPaymentType as (typeof PAYMENT_TYPES)[number])
    : 'hourly'
  const isActive = (activeFor as readonly string[]).includes(paymentType)

  // The CrudForm renders the field's label unconditionally for non-
  // checkbox types, so returning null here would leave the "Hourly rate"
  // / "Piece rate" label floating above empty space. Render a muted
  // placeholder instead so the form stays legible.
  if (!isActive) {
    return (
      <span className="text-xs text-muted-foreground">
        {t('routing.operation.form.rateInactive', 'Not applicable for this payment type.')}
      </span>
    )
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => setValue(e.target.value)}
      placeholder="0.00"
      disabled={disabled}
    />
  )
}
