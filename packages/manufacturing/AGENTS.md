# Manufacturing Package — Agent Guidelines

`@open-mercato/manufacturing` is an **external extension** package containing 4 modules that add manufacturing capabilities (BOM, routing, configurator, product master) to Open Mercato without modifying core.

## Package Structure

```
packages/manufacturing/src/
├── index.ts                    # Exports product_master + configurator modules
├── lib/                        # Shared utilities (entity-utils, variant-condition)
└── modules/
    ├── product_master/         # Product manufacturing extensions, production methods, UoM, supplier info
    ├── bom/                    # Bill of materials: headers, lines, line variants, explosion
    ├── routing/                # Routing templates, operations, work centers, factory zones, dependencies
    └── configurator/           # Config attributes, constraint rules, resolution engine
```

## MUST Rules

1. **MUST NOT modify any file in `packages/core/`, `packages/ui/`, or `packages/shared/`** — this is an external extension; use UMES extension points only
2. **MUST use FK IDs for cross-module references** — `product_id` references `catalog_products.id` but no ORM relationship across packages
3. **MUST prefix all DB tables** with `manufacturing_` (e.g., `manufacturing_units_of_measure`, `manufacturing_production_methods`) except `product_manufacturing_extensions` and BOM/routing tables that use entity-specific prefixes
4. **MUST scope all queries** by `organization_id` AND `tenant_id`
5. **MUST use `apiCall`/`apiCallOrThrow`** for all UI API calls — never raw `fetch`
6. **MUST use `useT()` for all user-facing strings** — use `manufacturing.*` i18n key namespace
7. **MUST use `Button`/`IconButton` from `@open-mercato/ui/primitives`** — never raw `<button>` elements
8. **MUST hand-write migrations** — `yarn db:generate` produces full-schema diffs for external packages (see migration playbook below)

## Module Ownership

| Module | Entities | API Prefix | ACL Features |
|--------|----------|------------|--------------|
| product_master | ProductManufacturingExtension, ProductionMethod, UnitOfMeasure, SupplierInfo, UomConversion | `/api/manufacturing/` | `product_master.view`, `product_master.edit`, `product_master.supplier_info.*` |
| bom | BomHeader, BomLine, BomLineVariant | `/api/bom/`, `/api/bom-line/`, `/api/bom-line-variant/` | `bom.view`, `bom.create`, `bom.update`, `bom.delete`, `bom.explode` |
| routing | RoutingTemplate, OperationTemplate, OperationTemplateVariant, OperationDependency, WorkCenter, FactoryZone | `/api/routing/`, `/api/operation/`, `/api/work-center/`, `/api/factory-zone/` | `routing.view`, `routing.create`, `routing.update`, `routing.delete`, `routing.work_center.*` |
| configurator | ConfigAttribute, ConstraintRule | `/api/manufacturing/config-attribute/`, `/api/manufacturing/constraint-rule/`, `/api/manufacturing/configurator/` | `configurator.view`, `configurator.edit` |

## Cross-Module FK Conventions

- `product_id` → `catalog_products.id` (no ORM join — fetch separately via enricher or API)
- `base_uom_id` → `manufacturing_units_of_measure.id` (same package, ManyToOne OK)
- `bom_header_id` → `bom_headers.id` (cross-module within package, FK ID only)
- `routing_template_id` → `routing_templates.id` (cross-module within package, FK ID only)
- `work_center_id` → `manufacturing_work_centers.id` (cross-module within package, FK ID only)

## Backend Page Nesting Convention

Pages nest under `backend/manufacturing/` subdirectory to get `/backend/manufacturing/` URL prefix:

```
product_master/backend/manufacturing/products/page.tsx      → /backend/manufacturing/products
product_master/backend/manufacturing/products/[id]/page.tsx → /backend/manufacturing/products/[id]
routing/backend/manufacturing/work-centers/page.tsx         → /backend/manufacturing/work-centers
routing/backend/manufacturing/work-centers/[id]/page.tsx    → /backend/manufacturing/work-centers/[id]
routing/backend/manufacturing/factory-zones/page.tsx        → /backend/manufacturing/factory-zones
product_master/backend/manufacturing/units-of-measure/page.tsx → /backend/manufacturing/units-of-measure
```

## Widget Injection Points

| Spot ID | Widget | Purpose |
|---------|--------|---------|
| `menu:sidebar:main` | `product_master.injection.manufacturing-menu` | Sidebar navigation with sub-items |
| `crud-form:catalog.product` | `product_master.injection.catalog-manufacturing-link` | "Enable Manufacturing" / "View Manufacturing Data" in catalog product detail |

## Migration Playbook (External Package)

`yarn db:generate` does not work correctly for external packages — it produces full-schema diffs instead of incremental migrations. Use this procedure:

1. Update ORM entities in `data/entities.ts`
2. Run `yarn db:generate` to see the SQL it would produce (for reference only)
3. Hand-write a migration file in `src/modules/<module>/migrations/MigrationYYYYMMDD00000N.ts`
4. Copy only the relevant `ALTER TABLE` / `CREATE TABLE` statements
5. Delete the auto-generated file (it contains the entire schema, not just the diff)

## Key Imports

```typescript
// UI
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { CrudForm, createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/crud'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { DataTable } from '@open-mercato/ui/backend/data-table'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

// Shared
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
```

## i18n Key Namespace

All translation keys use module-prefixed namespaces:
- `manufacturing.nav.*` — navigation labels
- `manufacturing.products.*` — product list/detail page strings
- `manufacturing.workCenters.*` — work center pages
- `manufacturing.factoryZones.*` — factory zone pages
- `manufacturing.uom.*` — unit of measure pages
- `bom.*` — BOM tab strings
- `routing.*` — routing tab strings
- `configurator.*` — configurator tab strings
