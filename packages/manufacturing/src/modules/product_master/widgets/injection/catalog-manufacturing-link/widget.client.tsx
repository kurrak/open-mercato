'use client'

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Factory, ArrowRight } from 'lucide-react'
import { useFeatureFlag } from '../../../../../lib/useFeatureFlag'

export default function CatalogManufacturingLinkWidget({
  data,
  context,
}: InjectionWidgetComponentProps) {
  const t = useT()
  const router = useRouter()

  const typedData = data as Record<string, unknown> | undefined
  const typedContext = context as Record<string, unknown> | undefined
  const productId =
    (typedContext?.recordId as string) ??
    (typedContext?.resourceId as string) ??
    (typedData?.id as string) ??
    null

  React.useEffect(() => {
    if (!productId) {
      console.warn(
        '[catalog-manufacturing-link] mounted without a product id — expected widget context to expose recordId/resourceId. Skipping render.',
      )
    }
  }, [productId])

  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `manufacturing-catalog-link:${productId ?? ''}`,
  })
  const [isCreating, setIsCreating] = React.useState(false)
  const [hasExtension, setHasExtension] = React.useState<boolean | null>(null)
  const [checkFailed, setCheckFailed] = React.useState(false)
  const canEdit = useFeatureFlag('product_master.edit')

  React.useEffect(() => {
    if (!productId) return
    let cancelled = false
    const check = async () => {
      try {
        const result = await readApiResultOrThrow<{
          items?: Array<{ id: string }>
          total?: number
        }>(
          `/api/product_master/manufacturing/product-manufacturing-extension?productId=${productId}&pageSize=1`,
          undefined,
          { errorMessage: '' },
        )
        if (!cancelled) {
          setHasExtension((result?.total ?? 0) > 0)
        }
      } catch {
        // Non-2xx or network error: hide the widget rather than speculatively
        // rendering the Enable button. A viewer hitting a 403 here would
        // otherwise see a button that 403s again on click.
        if (!cancelled) setCheckFailed(true)
      }
    }
    check()
    return () => { cancelled = true }
  }, [productId])

  const handleEnable = React.useCallback(async () => {
    if (!productId || isCreating) return
    setIsCreating(true)
    try {
      await runMutation({
        operation: () => createCrud('product_master/manufacturing/product-manufacturing-extension', {
          productId,
          procurementType: 'make',
          configurationType: 'none',
        }),
        context: {
          formId: `manufacturing-catalog-link:${productId}`,
          productId,
          retryLastMutation,
        },
      })
      flash(t('manufacturing.products.flash.added', 'Product added to manufacturing'), 'success')
      router.push(`/backend/manufacturing/products/${productId}`)
    } catch {
      flash(t('manufacturing.products.flash.addError', 'Failed to add product to manufacturing'), 'error')
    } finally {
      setIsCreating(false)
    }
  }, [productId, isCreating, retryLastMutation, router, runMutation, t])

  if (!productId) return null
  if (checkFailed) return null

  if (hasExtension === null) {
    return <p className="text-xs text-muted-foreground">{t('manufacturing.common.loading', 'Loading...')}</p>
  }

  if (hasExtension) {
    return (
      <Button type="button" variant="link" size="sm" className="h-auto p-0" asChild>
        <Link href={`/backend/manufacturing/products/${productId}`}>
          <Factory className="mr-1 size-3" />
          {t('manufacturing.catalog.viewManufacturing', 'View Manufacturing Data →')}
        </Link>
      </Button>
    )
  }

  if (!canEdit) return null

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleEnable}
      disabled={isCreating}
    >
      <Factory className="mr-1 size-3" />
      {t('manufacturing.catalog.enableManufacturing', 'Enable Manufacturing')}
    </Button>
  )
}
