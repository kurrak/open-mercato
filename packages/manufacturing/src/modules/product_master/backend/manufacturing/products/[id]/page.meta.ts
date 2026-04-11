export const metadata = {
  requireAuth: true,
  requireFeatures: ['product_master.view'],
  pageTitle: 'Manufacturing Product',
  pageTitleKey: 'manufacturing.products.detail.title',
  pageGroup: 'Manufacturing',
  pageGroupKey: 'manufacturing.nav.group',
  navHidden: true,
  breadcrumb: [
    {
      label: 'Manufacturing Products',
      labelKey: 'manufacturing.products.page.title',
      href: '/backend/manufacturing/products',
    },
  ],
}
