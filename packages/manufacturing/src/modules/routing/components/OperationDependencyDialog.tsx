'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { validateDag, type DependencyEdge } from '../lib/dependency-graph'
import type { OperationRow } from '../hooks/useOperationsForRouting'
import type { OperationDependencyRow } from '../hooks/useOperationDependencies'

type DependencyType = 'finish_to_start' | 'start_to_start' | 'finish_to_finish'
type LinkStrength = 'required' | 'optional'

type DependencyFormValues = {
  predecessorOperationId: string
  successorOperationId: string
  dependencyType: DependencyType
  linkStrength: LinkStrength
}

const DEFAULT_VALUES: DependencyFormValues = {
  predecessorOperationId: '',
  successorOperationId: '',
  dependencyType: 'finish_to_start',
  linkStrength: 'required',
}

export type OperationDependencyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  routingTemplateId: string
  operations: readonly OperationRow[]
  existingDependencies: readonly OperationDependencyRow[]
  onSuccess: () => void
}

export function OperationDependencyDialog({
  open,
  onOpenChange,
  routingTemplateId: _routingTemplateId,
  operations,
  existingDependencies,
  onSuccess,
}: OperationDependencyDialogProps) {
  const t = useT()

  // Force a fresh CrudForm mount on each open so field values, focus, and
  // internal error state all reset — otherwise a previously-dismissed
  // dialog can surface stale inputs or errors when reopened.
  const [openToken, setOpenToken] = React.useState(0)
  React.useEffect(() => {
    if (open) setOpenToken((n) => n + 1)
  }, [open])

  const operationOptions = React.useMemo(
    () => [
      { value: '', label: t('routing.dependency.form.selectPlaceholder', 'Select an operation…') },
      ...operations.map((op) => ({
        value: op.id,
        label: `${op.sequence}. ${op.name}`,
      })),
    ],
    [operations, t],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'predecessorOperationId',
        label: t('routing.dependency.form.predecessor', 'Predecessor'),
        type: 'select',
        required: true,
        options: operationOptions,
      },
      {
        id: 'successorOperationId',
        label: t('routing.dependency.form.successor', 'Successor'),
        type: 'select',
        required: true,
        options: operationOptions,
      },
      {
        id: 'dependencyType',
        label: t('routing.dependency.form.dependencyType', 'Dependency type'),
        type: 'select',
        options: [
          { value: 'finish_to_start', label: t('routing.dependency.type.finish_to_start', 'Finish-to-start') },
          { value: 'start_to_start', label: t('routing.dependency.type.start_to_start', 'Start-to-start') },
          { value: 'finish_to_finish', label: t('routing.dependency.type.finish_to_finish', 'Finish-to-finish') },
        ],
      },
      {
        id: 'linkStrength',
        label: t('routing.dependency.form.linkStrength', 'Link strength'),
        type: 'select',
        options: [
          { value: 'required', label: t('routing.dependency.strength.required', 'Required') },
          { value: 'optional', label: t('routing.dependency.strength.optional', 'Optional') },
        ],
      },
    ],
    [operationOptions, t],
  )

  const handleSubmit = React.useCallback(
    async (values: DependencyFormValues) => {
      const pred = values.predecessorOperationId
      const succ = values.successorOperationId

      // All client-detected errors below throw createCrudFormError so
      // CrudForm surfaces them in its native error banner — same place a
      // server error would land. Keeps a single error surface in the
      // dialog (no separate local Notice). The pre-checks duplicate
      // server-side guarantees (validateDag catches self-reference; DB
      // UNIQUE(predecessor, successor) catches duplicates) but buy us
      // nicer messages and skip a wasted round-trip.
      if (!pred || !succ) {
        throw createCrudFormError(
          t('routing.dependency.error.missingOperations', 'Pick both a predecessor and a successor.'),
        )
      }

      if (pred === succ) {
        throw createCrudFormError(
          t('routing.dependency.error.selfReference', 'Predecessor and successor must be different operations.'),
        )
      }

      const duplicate = existingDependencies.some(
        (dep) => dep.predecessor_operation_id === pred && dep.successor_operation_id === succ,
      )
      if (duplicate) {
        throw createCrudFormError(
          t('routing.dependency.error.duplicate', 'This dependency already exists.'),
        )
      }

      // Client-side cycle pre-check via the shared pure validator. The
      // server's /validate-graph endpoint runs the same logic and is
      // authoritative; we run it locally here to give the user an
      // inline error with the cycle path instead of a generic reject
      // after save. Consumes the structured `cycle` field (ids, in
      // topological order of the stuck set) rather than string-matching
      // the errors text — so the rendering stays stable if the error
      // copy is ever reworded.
      const operationIds = operations.map((op) => op.id)
      const simulatedEdges: DependencyEdge[] = [
        ...existingDependencies.map((dep) => ({
          predecessorId: dep.predecessor_operation_id,
          successorId: dep.successor_operation_id,
        })),
        { predecessorId: pred, successorId: succ },
      ]
      const validation = validateDag(operationIds, simulatedEdges)
      if (!validation.valid) {
        if (validation.cycle && validation.cycle.length > 0) {
          const opNamesById = new Map<string, string>()
          for (const op of operations) opNamesById.set(op.id, op.name)
          const friendly = validation.cycle
            .map((id) => opNamesById.get(id) ?? id.slice(0, 8))
            .join(' → ')
          throw createCrudFormError(
            t('routing.dependency.error.cycle', 'Adding this dependency would create a cycle: {path}').replace(
              '{path}',
              friendly,
            ),
          )
        }
        throw createCrudFormError(
          validation.errors[0] ?? t('routing.dependency.error.invalid', 'Dependency is invalid.'),
        )
      }

      await createCrud('routing/operation-dependency', {
        predecessorOperationId: pred,
        successorOperationId: succ,
        dependencyType: values.dependencyType,
        linkStrength: values.linkStrength,
      })
      flash(t('routing.dependency.flash.created', 'Dependency added.'), 'success')
      onOpenChange(false)
      onSuccess()
    },
    [existingDependencies, onOpenChange, onSuccess, operations, t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg [&_.grid]:!grid-cols-1">
        <DialogHeader>
          <DialogTitle>{t('routing.dependency.dialog.createTitle', 'Add dependency')}</DialogTitle>
        </DialogHeader>
        <CrudForm<DependencyFormValues>
          key={openToken}
          fields={fields}
          initialValues={DEFAULT_VALUES}
          submitLabel={t('routing.dependency.dialog.submit', 'Add dependency')}
          embedded
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
