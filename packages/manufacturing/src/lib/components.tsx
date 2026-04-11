'use client'

import * as React from 'react'
import { selectClassName } from './styles'

/**
 * Styled native `<select>` that matches OM input styling. Stopgap until `packages/ui`
 * ships a Select primitive — centralises `selectClassName` so the three+ call sites
 * (OverviewTab, UoM, factory zones) don't drift.
 */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...rest }, ref) {
    const finalClassName = className ? `${selectClassName} ${className}` : selectClassName
    return <select ref={ref} className={finalClassName} {...rest} />
  },
)

/** Renders a code string in monospace (e.g., "WC-001") */
export function CodeCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">{'—'}</span>
  return <span className="font-mono text-xs">{value}</span>
}

/** Renders "Name (CODE)" with the code portion in monospace */
export function NameWithCode({ name, code }: { name?: string | null; code?: string | null }) {
  if (!name && !code) return <span className="text-muted-foreground">{'—'}</span>
  if (!code) return <span>{name}</span>
  if (!name) return <CodeCell value={code} />
  return <span>{name} (<span className="font-mono text-xs">{code}</span>)</span>
}

type DetailSectionProps = {
  title: React.ReactNode
  actions?: React.ReactNode
  variant?: 'default' | 'muted'
  contentClassName?: string
  children: React.ReactNode
}

/**
 * Card shell for a detail-page section: heading row (optional actions) + content.
 * Matches the convention used by shared section components (rounded-lg border bg-card p-4).
 * Prefer this over inlining the shell so visual refactors can happen in one place.
 */
export function DetailSection({
  title,
  actions,
  variant = 'default',
  contentClassName,
  children,
}: DetailSectionProps) {
  const headingClass =
    variant === 'muted' ? 'text-sm font-medium text-muted-foreground' : 'text-sm font-medium'
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className={headingClass}>{title}</h3>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  )
}
