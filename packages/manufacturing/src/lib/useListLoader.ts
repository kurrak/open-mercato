'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type ListResponse<T> = {
  items?: T[]
  total?: number
  totalPages?: number
}

export type UseListLoaderOptions = {
  /**
   * Fully-built request URL including query string. Memoize with `useMemo` on
   * the filter/sort/page inputs; the hook re-fetches whenever the URL changes.
   */
  url: string
  /**
   * Extra bump key for forcing a re-fetch when the URL is unchanged (for
   * example combining `reloadToken` and `scopeVersion` into a single string).
   */
  reloadKey?: string | number
  /** When false, skips the fetch. Defaults to `true`. */
  enabled?: boolean
  /** Flash message shown on failure. Also used as the `readApiResultOrThrow` errorMessage. */
  errorMessage: string
}

export type UseListLoaderResult<T> = {
  rows: T[]
  total: number
  totalPages: number
  isLoading: boolean
  hasError: boolean
}

/**
 * Shared list-loader hook for manufacturing pages. Handles fetch → state → error flash
 * → in-flight cancellation so the individual list pages don't have to re-implement the
 * same 30-line boilerplate each time.
 *
 * Usage:
 *   const url = React.useMemo(() => {
 *     const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
 *     if (search.trim()) params.set('search', search.trim())
 *     return `/api/routing/work-center?${params.toString()}`
 *   }, [page, search])
 *
 *   const { rows, total, totalPages, isLoading } = useListLoader<WorkCenterRow>({
 *     url,
 *     reloadKey: `${reloadToken}:${scopeVersion}`,
 *     errorMessage: t('manufacturing.common.error', 'An error occurred'),
 *   })
 */
export function useListLoader<T>({
  url,
  reloadKey,
  enabled = true,
  errorMessage,
}: UseListLoaderOptions): UseListLoaderResult<T> {
  const [rows, setRows] = React.useState<T[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(false)
  const [hasError, setHasError] = React.useState(false)

  const errorMessageRef = React.useRef(errorMessage)
  errorMessageRef.current = errorMessage

  React.useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }
    let cancelled = false
    const load = async () => {
      setIsLoading(true)
      try {
        const data = await readApiResultOrThrow<ListResponse<T>>(
          url,
          undefined,
          { errorMessage: errorMessageRef.current },
        )
        if (cancelled) return
        setRows(Array.isArray(data?.items) ? data.items : [])
        setTotal(typeof data?.total === 'number' ? data.total : 0)
        setTotalPages(typeof data?.totalPages === 'number' ? data.totalPages : 1)
        setHasError(false)
      } catch (err) {
        if (cancelled) return
        // Keep the previous rows visible so a transient 500 does not wipe the grid
        // mid-session. Callers can read `hasError` to render an inline banner.
        setHasError(true)
        const message = err instanceof Error && err.message ? err.message : errorMessageRef.current
        flash(message, 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [url, reloadKey, enabled])

  return { rows, total, totalPages, isLoading, hasError }
}
