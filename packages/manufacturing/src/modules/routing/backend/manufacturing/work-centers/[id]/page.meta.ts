export const metadata = {
  requireAuth: true,
  requireFeatures: ['routing.work_center.manage'],
  pageTitle: 'Work Center',
  pageTitleKey: 'manufacturing.workCenters.form.editTitle',
  pageGroup: 'Manufacturing',
  pageGroupKey: 'manufacturing.nav.group',
  navHidden: true,
  breadcrumb: [
    {
      label: 'Work Centers',
      labelKey: 'manufacturing.workCenters.page.title',
      href: '/backend/manufacturing/work-centers',
    },
  ],
}
