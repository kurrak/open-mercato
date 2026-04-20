'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// Minimal in-place WorkCenter create — just name + code. The full
// WorkCenter master-data page (routing/backend/.../work-centers) exposes
// everything else (capacity, efficiency, scheduling mode, rates, zone).
// Server defaults fill the rest (capacity=1, efficiency=100,
// scheduling_mode='infinite', is_active=true).

type WorkCenterQuickCreateValues = {
  name: string
  code: string
}

const DEFAULT_VALUES: WorkCenterQuickCreateValues = { name: '', code: '' }

export type WorkCenterQuickCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (created: { id: string; name: string; code: string }) => void
}

export function WorkCenterQuickCreateDialog({
  open,
  onOpenChange,
  onSuccess,
}: WorkCenterQuickCreateDialogProps) {
  const t = useT()

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'name',
        label: t('routing.workCenterQuickCreate.name', 'Name'),
        type: 'text',
        required: true,
        placeholder: t('routing.workCenterQuickCreate.namePlaceholder', 'e.g. Foam station'),
      },
      {
        id: 'code',
        label: t('routing.workCenterQuickCreate.code', 'Code'),
        type: 'text',
        required: true,
        placeholder: t('routing.workCenterQuickCreate.codePlaceholder', 'e.g. WC-FOAM'),
      },
    ],
    [t],
  )
  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'main',
        title: t('routing.workCenterQuickCreate.group.main', 'Work center'),
        fields: ['name', 'code'],
      },
    ],
    [t],
  )

  const handleSubmit = React.useCallback(
    async (values: WorkCenterQuickCreateValues) => {
      const result = await createCrud<{ id?: string }>('routing/work-center', {
        name: values.name.trim(),
        code: values.code.trim(),
      })
      const id = result.result?.id
      if (!id) {
        flash(
          t(
            'routing.workCenterQuickCreate.noId',
            'Work center created, but the server response did not include its id — pick it manually.',
          ),
          'warning',
        )
        onOpenChange(false)
        return
      }
      flash(t('routing.workCenterQuickCreate.success', 'Work center created.'), 'success')
      onSuccess({ id, name: values.name.trim(), code: values.code.trim() })
    },
    [onOpenChange, onSuccess, t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md [&_.grid]:!grid-cols-1">
        <DialogHeader>
          <DialogTitle>{t('routing.workCenterQuickCreate.title', 'Create work center')}</DialogTitle>
        </DialogHeader>
        {/*
          Stop-propagation boundary: this dialog is mounted from inside the
          OperationDialog's CrudForm (via the work-center picker field).
          React bubbles synthetic events through the virtual tree even
          across Radix portals, so without this guard the inner form's
          submit (and Enter keypress) would also fire the outer
          OperationDialog's onSubmit — accepting and closing the outer
          dialog on every quick-create. Keep both handlers: submit covers
          the button click, keydown covers Cmd/Ctrl+Enter before the form
          wraps it in a submit event.
        */}
        <div
          onSubmit={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') e.stopPropagation()
          }}
        >
          <CrudForm<WorkCenterQuickCreateValues>
            fields={fields}
            groups={groups}
            initialValues={DEFAULT_VALUES}
            submitLabel={t('routing.workCenterQuickCreate.submit', 'Create')}
            embedded
            onSubmit={handleSubmit}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
