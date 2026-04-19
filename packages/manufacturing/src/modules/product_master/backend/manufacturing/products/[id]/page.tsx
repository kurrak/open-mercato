'use client'

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { ManufacturingTabsLayout, type TabDefinition } from '../../../../components/detail/ManufacturingTabsLayout'
import OverviewTab from '../../../../components/detail/OverviewTab'
import BomTab from '../../../../../bom/components/BomTab'
import RoutingTab from '../../../../../routing/components/RoutingTab'
import ConfiguratorTab from '../../../../../configurator/components/ConfiguratorTab'

type CatalogProductWithExtensionResponse = {
  items?: Array<{
    id: string
    title?: string
    sku?: string | null
    manufacturing_extension_id: string | null
    _manufacturing: {
      configuration_type: string | null
      procurement_type: string | null
      base_uom_id: string | null
      base_uom_code: string | null
      is_phantom_default: boolean
      production_method_count: number
    } | null
  }>
}

type CatalogProduct = {
  id: string
  title?: string
  sku?: string | null
}

type ManufacturingExtension = {
  id: string
  productId: string
  configurationType: string
  procurementType: string
  baseUomId: string | null
  isPhantomDefault: boolean
}

type TabId = 'overview' | 'bom' | 'routing' | 'configurator'

export default function ManufacturingProductDetailPage({
  params,
}: {
  params?: { id?: string }
}) {
  const t = useT()
  const router = useRouter()
  const productId = params?.id
  const [product, setProduct] = React.useState<CatalogProduct | null>(null)
  const [extension, setExtension] = React.useState<ManufacturingExtension | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<TabId>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '') as TabId
      if (['overview', 'bom', 'routing', 'configurator'].includes(hash)) return hash
    }
    return 'overview'
  })
  const [reloadToken, setReloadToken] = React.useState(0)

  const reload = React.useCallback(() => setReloadToken((n) => n + 1), [])

  React.useEffect(() => {
    if (!productId) return
    let cancelled = false
    const load = async () => {
      setIsLoading(true)
      setNotFound(false)
      try {
        const data = await readApiResultOrThrow<CatalogProductWithExtensionResponse>(
          `/api/product_master/manufacturing/catalog-products?enrolled=true&id=${encodeURIComponent(productId)}&pageSize=1`,
          undefined,
          { errorMessage: t('manufacturing.common.error', 'An error occurred') },
        )
        if (cancelled) return

        const row = data?.items?.[0]
        if (!row || !row.id || !row.manufacturing_extension_id || !row._manufacturing) {
          setNotFound(true)
          return
        }

        setProduct({ id: row.id, title: row.title, sku: row.sku ?? null })
        setExtension({
          id: row.manufacturing_extension_id,
          productId: row.id,
          configurationType: row._manufacturing.configuration_type ?? 'none',
          procurementType: row._manufacturing.procurement_type ?? 'make',
          baseUomId: row._manufacturing.base_uom_id,
          isPhantomDefault: row._manufacturing.is_phantom_default,
        })
      } catch (err) {
        if (cancelled) return
        setNotFound(true)
        const message = err instanceof Error && err.message
          ? err.message
          : t('manufacturing.common.error', 'An error occurred')
        flash(message, 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [productId, reloadToken, t])

  if (isLoading) return <LoadingMessage label={t('manufacturing.common.loading', 'Loading...')} />

  if (notFound || !product || !extension) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <ErrorMessage label={t('manufacturing.products.detail.notFound', 'Manufacturing product not found')} />
        <Button type="button" variant="outline" asChild>
          <Link href="/backend/manufacturing/products">
            <ArrowLeft className="mr-2 size-4" />
            {t('manufacturing.products.detail.backToList', 'Back to Products')}
          </Link>
        </Button>
      </div>
    )
  }

  const procurementLabels: Record<string, string> = {
    make: t('manufacturing.enum.procurement.make', 'Make'),
    buy: t('manufacturing.enum.procurement.buy', 'Buy'),
    buy_and_make: t('manufacturing.enum.procurement.buy_and_make', 'Make + Buy'),
    service: t('manufacturing.enum.procurement.service', 'Service'),
  }

  const configurationType = extension.configurationType

  const tabs: TabDefinition[] = [
    { id: 'overview', label: t('manufacturing.products.detail.tabs.overview', 'Overview') },
    { id: 'bom', label: t('manufacturing.products.detail.tabs.bom', 'Bill of Materials') },
    { id: 'routing', label: t('manufacturing.products.detail.tabs.routing', 'Routing') },
    {
      id: 'configurator',
      label: t('manufacturing.products.detail.tabs.configurator', 'Configurator'),
      hidden: configurationType === 'none',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('manufacturing.products.detail.backToList', 'Back to Products')}
          asChild
        >
          <Link href="/backend/manufacturing/products">
            <ArrowLeft className="mr-1 size-4" />
          </Link>
        </Button>
      </div>

      <FormHeader
        mode="detail"
        title={product.title || '—'}
        entityTypeLabel={t('manufacturing.products.detail.title', 'Manufacturing Product')}
        statusBadge={
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-secondary/80 text-secondary-foreground">
            {procurementLabels[extension.procurementType] ?? extension.procurementType}
          </span>
        }
        menuActions={[
          {
            id: 'edit-in-catalog',
            label: t('manufacturing.products.detail.editInCatalog', 'Edit in Catalog'),
            icon: ExternalLink,
            onSelect: () => router.push(`/backend/catalog/products/${product.id}`),
          },
        ]}
      />

      <ManufacturingTabsLayout
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => {
          setActiveTab(id as TabId)
          window.history.replaceState(null, '', `#${id}`)
        }}
      >
        {activeTab === 'overview' && (
          <OverviewTab
            productId={product.id}
            productTitle={product.title || ''}
            productSku={product.sku}
            catalogProductId={product.id}
            extension={extension}
            onExtensionUpdated={reload}
          />
        )}
        {activeTab === 'bom' && <BomTab productId={product.id} extension={extension} />}
        {activeTab === 'routing' && <RoutingTab productId={product.id} />}
        {activeTab === 'configurator' && <ConfiguratorTab productId={product.id} configurationType={extension.configurationType} />}
      </ManufacturingTabsLayout>
    </div>
  )
}
