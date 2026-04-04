export const metadata = {
  requireAuth: true,
  requireFeatures: ['product_master.view'],
}

export default function ManufacturingDashboardPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Manufacturing</h1>
      <p className="text-muted-foreground">
        Manufacturing product master data. Use the catalog product detail page to manage production methods, BOMs, routings, and configurator settings.
      </p>
    </div>
  )
}
