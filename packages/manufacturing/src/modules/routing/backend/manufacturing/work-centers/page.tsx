'use client'

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { CodeCell, NameWithCode } from '../../../../../lib/components'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useFeatureFlag } from '../../../../../lib/useFeatureFlag'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { useListLoader } from '../../../../../lib/useListLoader'

type WorkCenterRow = {
  id: string
  name: string
  code: string
  factory_zone_id: string | null
  capacity: number
  efficiency_percent: number
  scheduling_mode: string
  is_active: boolean
  notes: string | null
  default_hourly_rate: string | null
  overhead_rate_per_hour: string | null
  created_at: string
  updated_at: string
  _factoryZoneName?: string | null
}

const PAGE_SIZE = 25

export default function WorkCentersPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'manufacturing-work-centers',
  })
  const [page, setPage] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [search, setSearch] = React.useState('')
  const [reloadToken, setReloadToken] = React.useState(0)

  const [zoneMap, setZoneMap] = React.useState<Record<string, { name: string; code: string }>>({})
  const canManage = useFeatureFlag('routing.work_center.manage')

  const schedulingLabels = React.useMemo<Record<string, string>>(
    () => ({
      finite: t('manufacturing.workCenters.enum.scheduling.finite', 'Finite'),
      infinite: t('manufacturing.workCenters.enum.scheduling.infinite', 'Infinite'),
    }),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    readApiResultOrThrow<{ items?: Array<{ id: string; name: string; code: string }> }>(
      '/api/routing/factory-zone?pageSize=100',
      undefined,
      { errorMessage: '' },
    ).then((data) => {
      if (cancelled) return
      const map: Record<string, { name: string; code: string }> = {}
      for (const zone of data?.items ?? []) map[zone.id] = { name: zone.name, code: zone.code }
      setZoneMap(map)
    }).catch((err) => {
      // Non-fatal: the factory-zone column falls back to an em dash. The main
      // work-center list still loads and the user can still create/edit. Log at
      // warn level so a real regression here (e.g. route 500s for every viewer)
      // does not stay silent in production consoles.
      console.warn('[work-centers] failed to load factory-zone map', err)
    })
    return () => { cancelled = true }
  }, [])

  const reload = React.useCallback(() => setReloadToken((n) => n + 1), [])

  const url = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    if (search.trim()) params.set('search', search.trim())
    if (sorting.length > 0) {
      params.set('sortBy', sorting[0].id)
      params.set('sortOrder', sorting[0].desc ? 'desc' : 'asc')
    }
    return `/api/routing/work-center?${params.toString()}`
  }, [page, search, sorting])

  const { rows, total, totalPages, isLoading } = useListLoader<WorkCenterRow>({
    url,
    reloadKey: `${reloadToken}:${scopeVersion}`,
    errorMessage: t('manufacturing.common.error', 'An error occurred'),
  })

  const handleDelete = React.useCallback(
    async (row: WorkCenterRow) => {
      const confirmed = await confirm({
        title: t('manufacturing.workCenters.deleteConfirm.title', 'Delete Work Center?'),
        text: t(
          'manufacturing.workCenters.deleteConfirm.text',
          'This will permanently delete this work center. Operations referencing it will lose their assignment.',
        ),
        variant: 'destructive',
        confirmText: t('manufacturing.workCenters.actions.delete', 'Delete'),
      })
      if (!confirmed) return
      try {
        await runMutation({
          operation: () => deleteCrud('routing/work-center', row.id),
          context: {
            formId: 'manufacturing-work-centers',
            workCenterId: row.id,
            retryLastMutation,
          },
        })
        flash(t('manufacturing.workCenters.flash.deleted', 'Work center deleted'), 'success')
        reload()
      } catch {
        flash(t('manufacturing.workCenters.flash.deleteError', 'Failed to delete work center'), 'error')
      }
    },
    [confirm, reload, retryLastMutation, runMutation, t],
  )

  const columns = React.useMemo<ColumnDef<WorkCenterRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('manufacturing.workCenters.table.name', 'Name'),
        cell: ({ row }) => (
          <Link
            href={`/backend/manufacturing/work-centers/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.name || '—'}
          </Link>
        ),
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        accessorKey: 'code',
        header: t('manufacturing.workCenters.table.code', 'Code'),
        cell: ({ row }) => (
          <CodeCell value={row.original.code} />
        ),
        meta: { maxWidth: 120 },
      },
      {
        id: 'factoryZone',
        header: t('manufacturing.workCenters.table.factoryZone', 'Factory Zone'),
        cell: ({ row }) => {
          const zoneId = row.original.factory_zone_id
          const zone = zoneId ? zoneMap[zoneId] : null
          return (
            <span className="text-sm">
              {zone ? <NameWithCode name={zone.name} code={zone.code} /> : '—'}
            </span>
          )
        },
        meta: { maxWidth: 160 },
      },
      {
        accessorKey: 'capacity',
        header: t('manufacturing.workCenters.table.capacity', 'Capacity'),
        cell: ({ row }) => (
          <span className="text-sm">{row.original.capacity ?? '—'}</span>
        ),
        meta: { maxWidth: 80 },
      },
      {
        accessorKey: 'efficiency_percent',
        header: t('manufacturing.workCenters.table.efficiency', 'Efficiency %'),
        cell: ({ row }) => (
          <span className="text-sm">{row.original.efficiency_percent != null ? `${row.original.efficiency_percent}%` : '—'}</span>
        ),
        meta: { maxWidth: 100 },
      },
      {
        accessorKey: 'scheduling_mode',
        header: t('manufacturing.workCenters.table.schedulingMode', 'Scheduling'),
        cell: ({ row }) => {
          const mode = row.original.scheduling_mode
          if (!mode) return <span className="text-muted-foreground">—</span>
          const label = schedulingLabels[mode] ?? mode
          return (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-secondary/80 text-secondary-foreground">
              {label}
            </span>
          )
        },
        meta: { maxWidth: 120 },
      },
      {
        accessorKey: 'is_active',
        header: t('manufacturing.workCenters.table.active', 'Active'),
        cell: ({ row }) => <BooleanIcon value={row.original.is_active} />,
        meta: { maxWidth: 70 },
      },
    ],
    [schedulingLabels, t, zoneMap],
  )

  return (
    <div className="space-y-4">
      <DataTable<WorkCenterRow>
        columns={columns}
        data={rows}
        searchValue={search}
        onSearchChange={setSearch}
        sorting={sorting}
        onSortingChange={setSorting}
        isLoading={isLoading}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages,
          onPageChange: setPage,
        }}
        actions={
          canManage ? (
            <Button type="button" asChild>
              <Link href="/backend/manufacturing/work-centers/create">
                {t('manufacturing.workCenters.actions.create', 'Create Work Center')}
              </Link>
            </Button>
          ) : undefined
        }
        rowActions={
          canManage
            ? (row) => (
                <RowActions
                  items={[
                    {
                      id: 'edit',
                      label: t('manufacturing.workCenters.actions.edit', 'Edit'),
                      href: `/backend/manufacturing/work-centers/${row.id}`,
                    },
                    {
                      id: 'delete',
                      label: t('manufacturing.workCenters.actions.delete', 'Delete'),
                      destructive: true,
                      onSelect: () => handleDelete(row),
                    },
                  ]}
                />
              )
            : undefined
        }
        rowClickActionIds={canManage ? ['edit'] : undefined}
      />

      {ConfirmDialogElement}
    </div>
  )
}
