'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Select } from '../../../lib/components'

export type BomHeaderOption = {
  id: string
  name: string
  bomUsage: string
  isActive: boolean
}

export type BomHeaderSelectorProps = {
  headers: readonly BomHeaderOption[]
  selectedId: string | null
  onSelect: (headerId: string | null) => void
}

/**
 * BOM header selector — a single combobox listing every BomHeader for the
 * product. The first header is selected by default (caller decides which
 * one; `useBomName` / the tab shell both use the first active header
 * sorted by created_at asc).
 *
 * The selector renders only when the product has more than one BomHeader;
 * when there is a single one, the tab shell skips rendering this component
 * entirely to reduce chrome in the common case.
 */
export function BomHeaderSelector({ headers, selectedId, onSelect }: BomHeaderSelectorProps) {
  const t = useT()

  if (headers.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <Select
        className="min-w-[240px]"
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
        aria-label={t('bom.selector.ariaLabel', 'Select a BOM')}
      >
        {headers.map((header) => (
          <option key={header.id} value={header.id}>
            {header.name}
            {header.bomUsage !== 'production' ? ` (${header.bomUsage})` : ''}
            {!header.isActive ? ` — ${t('bom.selector.inactiveSuffix', 'inactive')}` : ''}
          </option>
        ))}
      </Select>
    </div>
  )
}
