'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type TabDefinition = {
  id: string
  label: React.ReactNode
  hidden?: boolean
}

type ManufacturingTabsLayoutProps = {
  tabs: TabDefinition[]
  activeTab: string
  onTabChange: (id: string) => void
  navAriaLabel?: string
  className?: string
  children: React.ReactNode
}

export function ManufacturingTabsLayout({
  tabs,
  activeTab,
  onTabChange,
  navAriaLabel,
  className,
  children,
}: ManufacturingTabsLayoutProps) {
  const t = useT()
  const resolvedAriaLabel = navAriaLabel ?? t('manufacturing.tabs.ariaLabel', 'Manufacturing tabs')
  const visibleTabs = tabs.filter((tab) => !tab.hidden)

  return (
    <div className={cn('space-y-4', className)}>
      <nav
        className="flex flex-wrap items-center gap-3 border-b text-sm"
        role="tablist"
        aria-label={resolvedAriaLabel}
      >
        {visibleTabs.map((tab) => (
          <Button
            key={tab.id}
            type="button"
            variant="ghost"
            size="sm"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'h-auto rounded-none border-b-2 px-3 py-2 hover:bg-transparent',
              activeTab === tab.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Button>
        ))}
      </nav>
      <div role="tabpanel">{children}</div>
    </div>
  )
}
