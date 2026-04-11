'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  WORK_CENTERS_LIST_HREF,
  WORK_CENTER_DEFAULT_VALUES,
  buildWorkCenterFormFields,
  buildWorkCenterFormGroups,
  submitWorkCenterCreate,
  type WorkCenterFormValues,
} from '@open-mercato/manufacturing/modules/routing/components/WorkCenterFormConfig'

export default function WorkCenterCreatePage() {
  const t = useT()
  const fields = React.useMemo(() => buildWorkCenterFormFields(t), [t])
  const groups = React.useMemo(() => buildWorkCenterFormGroups(t), [t])
  const successFlash = encodeURIComponent(
    t('manufacturing.workCenters.flash.created', 'Work center created'),
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<WorkCenterFormValues>
          title={t('manufacturing.workCenters.form.createTitle', 'Create work center')}
          backHref={WORK_CENTERS_LIST_HREF}
          fields={fields}
          groups={groups}
          initialValues={WORK_CENTER_DEFAULT_VALUES}
          submitLabel={t('manufacturing.workCenters.form.action.create', 'Create')}
          cancelHref={WORK_CENTERS_LIST_HREF}
          successRedirect={`${WORK_CENTERS_LIST_HREF}?flash=${successFlash}&type=success`}
          onSubmit={async (values) => {
            await submitWorkCenterCreate(values, t)
          }}
        />
      </PageBody>
    </Page>
  )
}
