'use client'

import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

// Minimal BomHeader create form. The full entity has more fields (isPhantom,
// version, notes) — we expose only the ones a user authoring a fresh BOM
// needs to fill. bomUsage defaults to 'production' server-side.

export type BomHeaderFormValues = {
  name: string
  bomUsage: string
  isActive: boolean
}

export const BOM_HEADER_DEFAULT_VALUES: BomHeaderFormValues = {
  name: '',
  bomUsage: 'production',
  isActive: true,
}

export function buildBomHeaderFormFields(t: (key: string, fallback: string) => string): CrudField[] {
  return [
    {
      id: 'name',
      label: t('bom.header.form.name', 'Name'),
      type: 'text',
      required: true,
      placeholder: t('bom.header.form.namePlaceholder', 'e.g. Production BOM'),
    },
    {
      id: 'bomUsage',
      label: t('bom.header.form.bomUsage', 'Usage'),
      type: 'select',
      options: [
        { value: 'production', label: t('bom.header.form.bomUsage.production', 'Production') },
        { value: 'packaging', label: t('bom.header.form.bomUsage.packaging', 'Packaging') },
      ],
    },
    {
      id: 'isActive',
      label: t('bom.header.form.isActive', 'Active'),
      type: 'checkbox',
    },
  ]
}

export function buildBomHeaderFormGroups(t: (key: string, fallback: string) => string): CrudFormGroup[] {
  return [
    {
      id: 'main',
      title: t('bom.header.form.group.main', 'BOM details'),
      fields: ['name', 'bomUsage', 'isActive'],
    },
  ]
}
