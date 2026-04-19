'use client'

import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

// Minimal RoutingTemplate create form. Version defaults to 1 server-side;
// notes/version are editable on a future edit dialog.

export type RoutingTemplateFormValues = {
  name: string
  isActive: boolean
}

export const ROUTING_TEMPLATE_DEFAULT_VALUES: RoutingTemplateFormValues = {
  name: '',
  isActive: true,
}

export function buildRoutingTemplateFormFields(t: (key: string, fallback: string) => string): CrudField[] {
  return [
    {
      id: 'name',
      label: t('routing.template.form.name', 'Name'),
      type: 'text',
      required: true,
      placeholder: t('routing.template.form.namePlaceholder', 'e.g. Seat assembly routing'),
    },
    {
      id: 'isActive',
      label: t('routing.template.form.isActive', 'Active'),
      type: 'checkbox',
    },
  ]
}

export function buildRoutingTemplateFormGroups(t: (key: string, fallback: string) => string): CrudFormGroup[] {
  return [
    {
      id: 'main',
      title: t('routing.template.form.group.main', 'Routing details'),
      fields: ['name', 'isActive'],
    },
  ]
}
