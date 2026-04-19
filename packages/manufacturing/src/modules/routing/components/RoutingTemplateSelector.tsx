'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Select } from '../../../lib/components'
import type { RoutingTemplateOption } from '../hooks/useRoutingTemplatesForProduct'

export type RoutingTemplateSelectorProps = {
  templates: readonly RoutingTemplateOption[]
  selectedId: string | null
  onSelect: (templateId: string | null) => void
}

/**
 * RoutingTemplate selector — a single combobox listing every
 * RoutingTemplate for the product. Rendered only when the product has more
 * than one routing; callers skip this component for the common
 * single-routing case (spec c §Routing selector).
 */
export function RoutingTemplateSelector({ templates, selectedId, onSelect }: RoutingTemplateSelectorProps) {
  const t = useT()

  if (templates.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <Select
        className="min-w-[240px]"
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
        aria-label={t('routing.selector.ariaLabel', 'Select a routing')}
      >
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
            {template.version > 1 ? ` (v${template.version})` : ''}
            {!template.isActive ? ` — ${t('routing.selector.inactiveSuffix', 'inactive')}` : ''}
          </option>
        ))}
      </Select>
    </div>
  )
}
