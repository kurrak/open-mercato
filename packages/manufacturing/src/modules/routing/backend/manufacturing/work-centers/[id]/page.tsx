'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ArrowLeft } from 'lucide-react'
import {
  WORK_CENTERS_LIST_HREF,
  buildWorkCenterFormFields,
  buildWorkCenterFormGroups,
  submitWorkCenterUpdate,
  workCenterRecordToFormValues,
  type WorkCenterFormValues,
  type WorkCenterRecord,
} from '@open-mercato/manufacturing/modules/routing/components/WorkCenterFormConfig'

type WorkCenterUsage = { operationCount: number; routingCount: number }

export default function WorkCenterEditPage({ params }: { params?: { id?: string } }) {
  const workCenterId = params?.id ?? ''
  const t = useT()
  const [initialValues, setInitialValues] = React.useState<WorkCenterFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [usage, setUsage] = React.useState<WorkCenterUsage | null>(null)

  React.useEffect(() => {
    if (!workCenterId) {
      setNotFound(true)
      setLoading(false)
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setNotFound(false)
      try {
        const listData = await readApiResultOrThrow<{ items?: WorkCenterRecord[] }>(
          `/api/routing/work-center?id=${encodeURIComponent(workCenterId)}&page=1&pageSize=1`,
          undefined,
          { errorMessage: t('manufacturing.common.error', 'An error occurred') },
        )
        const record = listData?.items?.[0] ?? null
        if (cancelled) return
        if (!record || !record.id) {
          setNotFound(true)
          return
        }
        setInitialValues(workCenterRecordToFormValues(record))
        try {
          const usageData = await readApiResultOrThrow<WorkCenterUsage>(
            `/api/routing/work-center-usage?id=${encodeURIComponent(workCenterId)}`,
            undefined,
            { errorMessage: t('manufacturing.common.error', 'An error occurred') },
          )
          if (!cancelled && usageData) setUsage(usageData)
        } catch {
          if (!cancelled) setUsage(null)
        }
      } catch (err) {
        if (cancelled) return
        setNotFound(true)
        const message = err instanceof Error && err.message
          ? err.message
          : t('manufacturing.common.error', 'An error occurred')
        flash(message, 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [workCenterId, t])

  const fields = React.useMemo(() => buildWorkCenterFormFields(t), [t])
  const groups = React.useMemo(() => buildWorkCenterFormGroups(t), [t])

  if (loading) {
    return <LoadingMessage label={t('manufacturing.common.loading', 'Loading...')} />
  }

  if (notFound || !initialValues) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <ErrorMessage label={t('manufacturing.workCenters.form.notFound', 'Work center not found')} />
        <Button type="button" variant="outline" asChild>
          <Link href={WORK_CENTERS_LIST_HREF}>
            <ArrowLeft className="mr-2 size-4" />
            {t('manufacturing.workCenters.actions.backToList', 'Back to Work Centers')}
          </Link>
        </Button>
      </div>
    )
  }

  const successFlash = encodeURIComponent(
    t('manufacturing.workCenters.flash.updated', 'Work center updated'),
  )
  const deleteFlash = encodeURIComponent(
    t('manufacturing.workCenters.flash.deleted', 'Work center deleted'),
  )

  const usageLabel = usage
    ? t(
        'manufacturing.workCenters.detail.usedBy',
        'Used by {count} operations across {routings} routings',
      )
        .replace('{count}', String(usage.operationCount))
        .replace('{routings}', String(usage.routingCount))
    : null

  return (
    <Page>
      <PageBody>
        {usageLabel ? (
          <div className="mb-4 rounded-md border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
            {usageLabel}
          </div>
        ) : null}
        <CrudForm<WorkCenterFormValues>
          title={t('manufacturing.workCenters.form.editTitle', 'Edit work center')}
          backHref={WORK_CENTERS_LIST_HREF}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('manufacturing.workCenters.form.action.save', 'Save')}
          cancelHref={WORK_CENTERS_LIST_HREF}
          successRedirect={`${WORK_CENTERS_LIST_HREF}?flash=${successFlash}&type=success`}
          onSubmit={async (values) => {
            await submitWorkCenterUpdate(workCenterId, values, t)
          }}
          onDelete={async () => {
            await deleteCrud('routing/work-center', workCenterId, {
              errorMessage: t('manufacturing.workCenters.form.errors.delete', 'Failed to delete work center'),
            })
          }}
          deleteRedirect={`${WORK_CENTERS_LIST_HREF}?flash=${deleteFlash}&type=success`}
        />
      </PageBody>
    </Page>
  )
}
