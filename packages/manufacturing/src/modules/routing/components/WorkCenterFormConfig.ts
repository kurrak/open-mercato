import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

type Translator = (key: string, fallback?: string) => string

export type WorkCenterFormValues = {
  id?: string
  name: string
  code: string
  factoryZoneId: string
  capacity: number
  efficiencyPercent: number
  schedulingMode: string
  defaultHourlyRate: string
  overheadRatePerHour: string
  notes: string
  isActive: boolean
}

export type WorkCenterRecord = {
  id: string
  name: string
  code: string
  factory_zone_id: string | null
  capacity: number
  efficiency_percent: number
  scheduling_mode: string
  default_hourly_rate: string | null
  overhead_rate_per_hour: string | null
  notes: string | null
  is_active: boolean
}

export const WORK_CENTERS_LIST_HREF = '/backend/manufacturing/work-centers'

const SCHEDULING_VALUES = ['finite', 'infinite'] as const

export const WORK_CENTER_DEFAULT_VALUES: WorkCenterFormValues = {
  name: '',
  code: '',
  factoryZoneId: '',
  capacity: 1,
  efficiencyPercent: 100,
  schedulingMode: 'finite',
  defaultHourlyRate: '',
  overheadRatePerHour: '',
  notes: '',
  isActive: true,
}

export function workCenterRecordToFormValues(record: WorkCenterRecord): WorkCenterFormValues {
  return {
    id: record.id,
    name: record.name ?? '',
    code: record.code ?? '',
    factoryZoneId: record.factory_zone_id ?? '',
    capacity: record.capacity ?? 1,
    efficiencyPercent: record.efficiency_percent ?? 100,
    schedulingMode: record.scheduling_mode ?? 'finite',
    defaultHourlyRate: record.default_hourly_rate ?? '',
    overheadRatePerHour: record.overhead_rate_per_hour ?? '',
    notes: record.notes ?? '',
    isActive: record.is_active ?? true,
  }
}

function buildWorkCenterPayload(values: WorkCenterFormValues, t: Translator): Record<string, unknown> {
  const name = typeof values.name === 'string' ? values.name.trim() : ''
  if (!name) {
    const message = t('manufacturing.workCenters.form.errors.name', 'Name is required')
    throw createCrudFormError(message, { name: message })
  }
  const code = typeof values.code === 'string' ? values.code.trim() : ''
  if (!code) {
    const message = t('manufacturing.workCenters.form.errors.code', 'Code is required')
    throw createCrudFormError(message, { code: message })
  }
  const capacityNumber = Number(values.capacity)
  const efficiencyNumber = Number(values.efficiencyPercent)
  const efficiencyValid =
    Number.isFinite(efficiencyNumber) && efficiencyNumber > 0 && efficiencyNumber <= 200
  return {
    name,
    code,
    factoryZoneId: values.factoryZoneId?.trim() || null,
    capacity: Number.isFinite(capacityNumber) && capacityNumber > 0 ? capacityNumber : 1,
    efficiencyPercent: efficiencyValid ? efficiencyNumber : 100,
    schedulingMode: values.schedulingMode || 'finite',
    defaultHourlyRate: values.defaultHourlyRate?.trim() || null,
    overheadRatePerHour: values.overheadRatePerHour?.trim() || null,
    notes: values.notes?.trim() || null,
    isActive: values.isActive !== false,
  }
}

export async function submitWorkCenterCreate(values: WorkCenterFormValues, t: Translator): Promise<void> {
  const payload = buildWorkCenterPayload(values, t)
  await createCrud('routing/work-center', payload)
}

export async function submitWorkCenterUpdate(
  workCenterId: string,
  values: WorkCenterFormValues,
  t: Translator,
): Promise<void> {
  const payload = buildWorkCenterPayload(values, t)
  await updateCrud('routing/work-center', { id: workCenterId, ...payload })
}

export function buildWorkCenterFormFields(t: Translator): CrudField[] {
  return [
    {
      id: 'name',
      label: t('manufacturing.workCenters.form.field.name', 'Name'),
      type: 'text',
      required: true,
      placeholder: t('manufacturing.workCenters.form.field.namePlaceholder', 'e.g., CNC Machine Bay'),
    },
    {
      id: 'code',
      label: t('manufacturing.workCenters.form.field.code', 'Code'),
      type: 'text',
      required: true,
      placeholder: t('manufacturing.workCenters.form.field.codePlaceholder', 'e.g., WC-CNC-01'),
    },
    {
      id: 'factoryZoneId',
      label: t('manufacturing.workCenters.form.field.factoryZone', 'Factory Zone'),
      type: 'select',
      loadOptions: async () => {
        try {
          const data = await readApiResultOrThrow<{ items?: Array<{ id: string; name: string; code: string }> }>(
            '/api/routing/factory-zone?pageSize=100&isActive=true',
            undefined,
            { errorMessage: '' },
          )
          return [
            { value: '', label: '—' },
            ...(data?.items ?? []).map((z) => ({ value: z.id, label: `${z.name} (${z.code})` })),
          ]
        } catch {
          // Non-fatal: the combobox falls back to the "—" (no zone) option. User can
          // still save — the factory zone is optional on a work center.
          return [{ value: '', label: '—' }]
        }
      },
    },
    {
      id: 'capacity',
      label: t('manufacturing.workCenters.form.field.capacity', 'Capacity'),
      type: 'number',
    },
    {
      id: 'efficiencyPercent',
      label: t('manufacturing.workCenters.form.field.efficiency', 'Efficiency %'),
      type: 'number',
      description: t('manufacturing.workCenters.form.field.efficiencyHelp', 'Percentage between 1 and 200.'),
    },
    {
      id: 'schedulingMode',
      label: t('manufacturing.workCenters.form.field.schedulingMode', 'Scheduling Mode'),
      type: 'select',
      options: SCHEDULING_VALUES.map((v) => ({
        value: v,
        label: t(`manufacturing.workCenters.enum.scheduling.${v}`, v),
      })),
    },
    {
      id: 'defaultHourlyRate',
      label: t('manufacturing.workCenters.form.field.defaultHourlyRate', 'Default Hourly Rate'),
      type: 'text',
      placeholder: t('manufacturing.workCenters.form.field.ratePlaceholder', 'e.g., 50.00'),
    },
    {
      id: 'overheadRatePerHour',
      label: t('manufacturing.workCenters.form.field.overheadRate', 'Overhead Rate / Hour'),
      type: 'text',
      placeholder: t('manufacturing.workCenters.form.field.ratePlaceholder', 'e.g., 50.00'),
    },
    {
      id: 'notes',
      label: t('manufacturing.workCenters.form.field.notes', 'Notes'),
      type: 'textarea',
    },
    {
      id: 'isActive',
      label: t('manufacturing.workCenters.form.field.isActive', 'Active'),
      type: 'checkbox',
    },
  ]
}

export function buildWorkCenterFormGroups(t: Translator): CrudFormGroup[] {
  return [
    {
      id: 'general',
      title: t('manufacturing.workCenters.form.group.general', 'General'),
      column: 1,
      fields: ['name', 'code', 'factoryZoneId', 'schedulingMode'],
    },
    {
      id: 'performance',
      title: t('manufacturing.workCenters.form.group.performance', 'Performance & Costing'),
      column: 1,
      fields: ['capacity', 'efficiencyPercent', 'defaultHourlyRate', 'overheadRatePerHour'],
    },
    {
      id: 'other',
      title: t('manufacturing.workCenters.form.group.other', 'Other'),
      column: 2,
      fields: ['notes', 'isActive'],
    },
  ]
}
