# Manufacturing UI

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-04-05 |
| **Related** | `2026-04-03-manufacturing-product-foundation.md` (main spec), sub-specs a–d (entity/API layer) |
| **Mode** | External Extension (`packages/manufacturing`) |
| **Builds on** | `@open-mercato/ui/backend` (CrudForm, DataTable, DetailTabsLayout), catalog widget injection |

---

## TLDR

**Key Points:**
- Build the complete backend UI for the manufacturing module: product list, tabbed product detail, master data management pages, and catalog integration widget
- Manufacturing product detail page uses `DetailTabsLayout` with 4 tabs: Overview, BOM, Routing, Configurator (conditional)
- UI follows the Graceful Incompleteness principle — progress indicators instead of error banners, save always succeeds, warnings on use not on save
- All entity creation that's contextual (BomLineVariant, OperationTemplateVariant, OperationDependency) is inline within parent tabs — no standalone pages
- Master data (WorkCenter, FactoryZone, UnitOfMeasure) gets standalone list+CRUD pages

**Scope:**
- 1 product list page with product picker dialog
- 1 tabbed product detail page (4 tabs)
- 3 standalone master data pages (work centers, factory zones, UoM)
- 1 catalog product widget injection (enable/view manufacturing)
- Sidebar navigation with 4 items
- Seed data hook (minimal generic example)

---

## Overview

The manufacturing module's entity layer (sub-specs a–d) is implemented with full API coverage but placeholder-only UI. This spec fills the UI gap: a self-contained manufacturing section in the backend where users manage product structure (BOM, routing, configuration) from a single tabbed detail page, with supporting master data pages for shared reference data.

The manufacturing detail page is the "product card" — one place to see and edit everything about how a product is manufactured, without navigating to separate module pages for BOM, routing, or configurator.

> **Market Reference**: Single product card approach follows Katana MRP (4 tabs, 0 clicks to BOM/routing) and MRPeasy (flat single page) patterns, with enterprise-level data depth. SAP's 25+ scattered views is the anti-pattern to avoid.

## Problem Statement

1. **No UI for manufacturing data.** All 14 manufacturing entities have CRUD APIs and backend logic, but the only UI is placeholder stubs ("will be implemented here"). Users cannot interact with BOM, routing, or configurator data through the browser.

2. **No unified product view for manufacturing.** OM's catalog product detail page is a commerce-focused CrudForm (title, SKU, pricing, media). Manufacturing data (BOM tree, routing graph, configuration rules) doesn't fit into a form — it needs its own tabbed layout with domain-specific visualizations.

3. **No master data management.** Work centers, factory zones, and units of measure are shared reference data used across all routings and BOMs, but there's no UI to manage them.

4. **No onboarding path.** Users cannot add existing catalog products to the manufacturing module — there's no "enable manufacturing" flow.

## Proposed Solution

Build a manufacturing section in the backend with its own navigation, product list, tabbed product detail, and master data pages. Integrate with catalog via widget injection for product onboarding.

### Design Decisions

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 1 | Manufacturing detail page ownership | **Manufacturing owns the product detail page** (Option D — manufacturing shell, not catalog extension) | Manufacturing data doesn't fit into catalog's CrudForm. Own page = full control over tab layout, no core catalog changes needed |
| 2 | Catalog product data access | **Link to catalog ("Edit in Catalog →"), not embed** | Avoids cross-module CrudForm embedding and potential drift. Manufacturing page focuses on manufacturing concerns; catalog page handles commerce fields |
| 3 | Readiness indicator | **Detail page only, not list page** | List page enricher would need to query across 3+ modules per product. Detail page computes readiness for a single product on load — acceptable cost |
| 4 | Variant override management | **Inline within parent tab, no standalone pages** | BomLineVariant only makes sense in context of its BomLine. OperationTemplateVariant only in context of its operation. Standalone pages would lose context |
| 5 | Master data management | **Standalone list+CRUD pages** | WorkCenter, FactoryZone, UoM are shared across all products — not tied to a single product's detail page |
| 6 | Configurator tab visibility | **Hidden for non-rule_based products** | Shows message "Uses variant-based configuration — manage variants in Catalog" for variant_based. Hidden entirely for none |
| 7 | URL routing | **Nest backend pages under `backend/manufacturing/` subdirectory** | OM auto-discovery maps `backend/<path>/page.tsx` → `/backend/<path>`. Same nesting trick as API routes. `product_master/backend/manufacturing/products/page.tsx` → `/backend/manufacturing/products`. Follows catalog precedent (`catalog/backend/catalog/products/page.tsx` → `/backend/catalog/products`) |
| 8 | Tabbed detail layout | **Build a local tab layout component within the manufacturing package** | `DetailTabsLayout` lives in `packages/core/src/modules/customers/components/detail/` — not a shared UI primitive. Cannot import from core/customers without creating cross-package dependency. Build a lightweight equivalent using OM's `Button` variant="ghost" tab pattern (see packages/ui/AGENTS.md tab navigation pattern). Simple component (~50 lines), no external dependency |

## Pages & Navigation

### Sidebar Navigation

```
Manufacturing
  ├── Products         → /backend/manufacturing/products
  ├── Work Centers     → /backend/manufacturing/work-centers
  ├── Factory Zones    → /backend/manufacturing/factory-zones
  └── Units of Measure → /backend/manufacturing/units-of-measure
```

Injected into the main sidebar via the existing `product_master.injection.manufacturing-menu` widget. Sub-items added as menu children.

### Page Map

| Page | Path | File Location | Module |
|---|---|---|---|
| Product list | `/backend/manufacturing/products` | `product_master/backend/manufacturing/products/page.tsx` | product_master |
| Product detail | `/backend/manufacturing/products/[id]` | `product_master/backend/manufacturing/products/[id]/page.tsx` | product_master (shell) + bom, routing, configurator (tab components) |
| Work centers | `/backend/manufacturing/work-centers` | `routing/backend/manufacturing/work-centers/page.tsx` | routing |
| Work center create | `/backend/manufacturing/work-centers/create` | `routing/backend/manufacturing/work-centers/create/page.tsx` | routing |
| Work center edit | `/backend/manufacturing/work-centers/[id]` | `routing/backend/manufacturing/work-centers/[id]/page.tsx` | routing |
| Factory zones | `/backend/manufacturing/factory-zones` | `routing/backend/manufacturing/factory-zones/page.tsx` | routing |
| Units of measure | `/backend/manufacturing/units-of-measure` | `product_master/backend/manufacturing/units-of-measure/page.tsx` | product_master |

> **Work center create vs edit**: the `create` and `[id]` routes are deliberately split into sibling page files so the `create` literal cannot collide with a record UUID in the `[id]` dynamic segment. Both share the same form fields/groups/submit helpers, extracted to `routing/components/WorkCenterFormConfig.ts`. `[id]/page.tsx` is edit-only.

**URL routing convention:** Backend pages nested under `backend/manufacturing/` subdirectory to get `/backend/manufacturing/` prefix. Same pattern as API routes (`api/manufacturing/`). Follows catalog precedent (`catalog/backend/catalog/products/` → `/backend/catalog/products`).

## Product List Page

**Path:** `/backend/manufacturing/products`

**DataTable columns:**

| Column | Source | Notes |
|---|---|---|
| Product name | CatalogProduct.title (via enricher) | Link to detail page |
| SKU | CatalogProduct.sku (via enricher) | — |
| Procurement type | ProductManufacturingExtension.procurement_type | Badge: make / buy / make+buy |
| Configuration type | ProductManufacturingExtension.configuration_type | Badge: none / variant / rule |
| Production methods | Count from enricher | Number |
| Base UoM | UnitOfMeasure.code (via extension FK) | — |

**Row actions:** Edit (→ detail page), Remove from manufacturing (soft-delete extension — with confirm dialog)

**Header action:** "Add Product" button

### Add Product Flow

1. User clicks "Add Product"
2. **Product picker dialog** opens — DataTable showing catalog products that do NOT have a ProductManufacturingExtension
3. Search/filter by product name, SKU
4. User selects a product → system creates ProductManufacturingExtension with defaults (procurement_type='make', configuration_type='none', base_uom_id=tenant default UoM)
5. Dialog closes → redirect to manufacturing product detail page for the selected product

**Picker query:** `GET /api/catalog/products` filtered to exclude product IDs that have extension records. Implementation: load extension product_ids, pass as exclusion filter.

## Product Detail Page

**Path:** `/backend/manufacturing/products/[id]`

**Layout:** `DetailTabsLayout` with `FormHeader` (mode='detail') showing product name, SKU, procurement type badge.

**Header actions:**
- "Edit in Catalog →" — link to `/backend/catalog/products/[catalogProductId]`

**Tabs:**

| Tab | Label | Module | Condition |
|---|---|---|---|
| Overview | Overview | product_master | Always |
| BOM | Bill of Materials | bom | Always |
| Routing | Routing | routing | Always |
| Configurator | Configurator | configurator | Only when configuration_type = 'rule_based'. Message for 'variant_based'. Hidden for 'none' |

### Overview Tab

**Product identity section** (read-only):
- Product name, SKU, status — fetched from CatalogProduct
- "Edit in Catalog →" link

**Manufacturing fields section** (editable):
- Procurement type — select dropdown (make / buy / buy_and_make / service)
- Configuration type — select dropdown (none / variant_based / rule_based)
- Base UoM — searchable combobox (UnitOfMeasure lookup, "Create new" shortcut → dialog)
- Phantom default — checkbox ("New BOMs for this product default to phantom")
- Save button — updates ProductManufacturingExtension via command

**Production methods section:**
- List of ProductionMethod records for this product
- Each card/row shows: name, version, lifecycle state badge (draft/active/superseded/archived), is_default flag, linked BOM name (or "No BOM"), linked routing name (or "No routing")
- Actions: Add PM, Edit PM (dialog), Delete PM, Set as default
- For most products: 1 PM. UI works for 1–5.

**Readiness checklist:**
```
Product Readiness
✓ Manufacturing enabled
✓ Base UoM set: piece
✓ 1 production method (active)
✓ BOM defined (12 lines)
○ Routing not linked
○ Configurator: 0 attributes
```
Computed on page load for this single product. Each item is a simple existence/count check against the API. ✓ = present, ○ = not yet defined. No red/error states.

### BOM Tab

**BOM header selector:** Two modes:
- **Auto-resolve** (default): when user provides config/variant in the explosion panel, system calls `POST /api/manufacturing/production-method/resolve` to find the best PM, then uses its linked `bom_header_id`. User doesn't manually pick a BOM.
- **Manual override**: dropdown showing all BomHeaders for this product (production + packaging). For power users or when auto-resolution returns no match.

**BOM tree view:**
- Hierarchical expandable tree: BomHeader → BomLines
- Each line row shows:

| Field | Display |
|---|---|
| Material | Product name (link to catalog) or "Material not selected" placeholder |
| Line type | Badge: material / semi_product |
| Quantity | `net_qty (gross_qty)` or "—" if null |
| UoM | Code or "—" |
| Scrap % | Percentage or "0%" |
| Variant condition | Badge with key summary (e.g., "seat_type: SD01, SD02") or empty |
| Operation | Linked operation name or "—" |
| Date range | valid_from – valid_to or "Always" |
| Consumable | Flag icon if true |
| Phantom | Ghost icon on child BomHeader rows where is_phantom=true |

**Inline actions per line:** Edit (dialog), Delete (confirm), Reorder (up/down arrow buttons — no drag-and-drop library in OM, use simple `sort_order` increment/decrement via API)

**Add line:** "Add Material" / "Add Sub-assembly" buttons → dialog with material picker (catalog product combobox), quantity, UoM, scrap %, variant condition editor, operation linker

**BomLineVariant (expandable per line):**
- Expand arrow on lines → shows variant override rows
- Each override: variant identifier (variant name or condition keys), quantity override, material override, unit override
- Inline add/edit/delete

**BOM explosion panel:**

The explosion input form adapts to what's defined — less configuration = simpler form. The "Explode BOM" button always works regardless of completeness.

| Product State | Explosion Input Form |
|---|---|
| `configuration_type = 'none'`, no variant conditions on any BomLine | Just "Explode BOM" button + effective date picker. No variant/config input needed — all lines always active |
| `configuration_type = 'variant_based'`, BomLineVariants exist | Variant picker (CatalogProductVariant select) + effective date. If no BomLineVariant records exist yet: picker still shown but with note "No variant-specific overrides defined — all variants produce the same material list". If BomLines have variant_condition values that don't match any existing CatalogProductVariant option values: warning "N lines reference variant values not found in product variants" with list of orphaned keys/values |
| `configuration_type = 'rule_based'`, ConfigAttributes defined | Dynamic attribute form (one field per attribute, type-appropriate input) + effective date. Calls configurator resolve first, then explodes with resolved conditions. If BomLines have variant_condition keys not matching any ConfigAttribute.key: warning "N lines reference unknown configuration keys" with list of orphaned keys |
| `configuration_type = 'rule_based'`, no ConfigAttributes yet | "Explode BOM" button + effective date + message "No configuration attributes defined — explosion will include all unconditional BOM lines." Lines with variant_condition are skipped, warning shown in result |
| Any type, BomLines have variant_conditions but no configurator/variants | "Explode BOM" button + effective date + warning "N lines have variant conditions but no configuration provided — conditional lines will be skipped" |

- Effective date picker (defaults to today) — shown in all cases for date-effective line filtering
- Submit → async job → progress indicator → result table:
  - Flat material list: material name, quantity, UoM, gross quantity, level, source BOM
  - Warnings panel (collapsible): "2 lines skipped: null material_id", "3 conditional lines skipped: no configuration provided", etc.

### Routing Tab

**Routing selector:** If product has multiple RoutingTemplates (via multiple PMs), dropdown at top.

**Operations DataTable:**

| Column | Display |
|---|---|
| Sequence | Number |
| Name | Operation name |
| Work center | WorkCenter name + code badge, or "No work center" |
| Setup time | Minutes or "—" |
| Run time | Minutes or "—" |
| Teardown time | Minutes or "—" |
| Payment type | Badge: hourly / piecework / mixed |
| Rate | Amount or "—" |
| Subcontracted | Flag icon if true |

**Inline actions:** Add operation (dialog with work center combobox + "Create new" shortcut), Edit, Delete, Reorder (up/down arrow buttons, same pattern as BOM lines)

**OperationTemplateVariant (expandable per operation):**
- Expand arrow → variant override rows
- Each override: variant identifier, time overrides, rate overrides, work center override
- Inline add/edit/delete

**Dependency section:**

Two views: a read-only flow visualization and a CRUD list for editing.

*Flow visualization (read-only, temporary — to be replaced with interactive graph editor in future):*

Uses the topological sort from `lib/dependency-graph.ts` to render operations grouped by execution level (operations with no unresolved predecessors = level 0, their successors = level 1, etc.). Parallel operations at the same level shown side-by-side. Connector lines/arrows show convergence points.

```
┌─ Foam lamination (WC-PIAN, 45 min)
├─ Cover sewing (WC-SZWAL, 60 min)
├─ Frame assembly (WC-SKRZ, 30 min)
├─ Side panel gluing (WC-BOCZKI, 25 min)
└─→ Upholstery (WC-TAPIC, 90 min)
     └─→ Quality check (WC-KJ, 15 min)
          └─→ Packaging (WC-PAK, 45 min)
```

Rendered with plain HTML/CSS (indented divs with connector lines). Each node shows: operation name, work center code, run time. Parallel paths visually grouped at the same indentation level. Convergence points marked with arrow connectors from all predecessors. Operations without dependencies shown at level 0 with a note "No dependencies — follows sequence order."

No graph library needed for initial implementation. Future: replace with interactive graph editor (React Flow or similar) where users can drag to create/remove dependencies visually.

*Dependency list (CRUD):*

Below the flow visualization:
  ```
  Dependencies:
  • Foam lamination → Upholstery (finish-to-start, required)
  • Cover sewing → Upholstery (finish-to-start, required)
  • Frame assembly → Upholstery (finish-to-start, required)
  ```
- Add dependency: select predecessor + successor from operations in this routing + type + strength
- Delete dependency (confirm)
- Cycle detection: if adding a dependency would create a cycle, show error in dialog before save

**Time rollup panel:**
- "Calculate Time" button
- Quantity input (default: 1)
- For variant products: variant/config selector
- Result: total occupation time, total lead time (critical path), per-operation breakdown
- Warnings panel for incomplete data

### Configurator Tab

**Visibility:** Only shown when `configuration_type = 'rule_based'`.

For `variant_based` products: tab shows message "This product uses variant-based configuration. Manage variants in the Catalog." with link to catalog product.

For `none`: tab not rendered in tab bar.

**Attributes section:**

DataTable of ConfigAttribute:

| Column | Display |
|---|---|
| Key | Technical key (monospace) |
| Label | Display name |
| Type | Badge: enum / numeric_range / boolean / text / material |
| Values | Comma-separated allowed values preview, or "Live catalog" for material type |
| Mandatory | Checkbox icon |
| Group | Group label |
| Order | Number |

Actions: Add attribute (dialog), Edit (dialog), Delete (confirm), Reorder

**Constraint rules section:**

DataTable of ConstraintRule:

| Column | Display |
|---|---|
| Description | Rule description text |
| Condition | Summary of condition_json (e.g., "When frame = SK23") |
| Action | Badge: restrict / exclude / require / default |
| Target | Summary of action_data (e.g., "→ legs must be H2.5") |
| Priority | Number |
| Active | Toggle |

Actions: Add rule (dialog), Edit (dialog), Delete (confirm)

**Resolution preview panel:**
- "Test Configuration" section
- Dynamic form generated from ConfigAttribute records — one field per active attribute. Custom `ConfigurationForm` component that maps `attribute_type` to OM input primitives:

| attribute_type | Input Component | Data Source |
|---|---|---|
| enum | Select (from `@open-mercato/ui/primitives`) | `allowed_values` array |
| numeric_range | Number input with min/max/step | `allowed_values` object `{min, max, step}` |
| boolean | Toggle/Checkbox | — |
| text | Text Input | — |
| material | Searchable combobox | CatalogProduct API filtered by `material_filter_id` category |

Form renders dynamically from loaded ConfigAttribute records, grouped by `attribute_group`. No hardcoded fields — form structure is entirely data-driven.
- "Resolve" button → calls `/api/manufacturing/configurator/resolve`
- Result display:
  - Resolved conditions (key → value table)
  - Applied rules (list of rule descriptions that fired)
  - Errors (red, blocking — invalid combinations)
  - Warnings (yellow — forced changes, missing attributes)

## Master Data Pages

### Work Centers

**Path:** `/backend/manufacturing/work-centers`

**DataTable columns:** Name, Code, Factory Zone, Capacity, Efficiency %, Scheduling Mode, Active

**Row actions:** Edit (→ detail page or dialog), Delete (confirm)

**Create/Edit:** CrudForm with fields: name, code (auto-generated suggestion from name), factory zone (combobox), capacity (number), efficiency (number, default 100), scheduling mode (select: infinite/finite), hourly rate, overhead rate, notes

**Detail page** (`/backend/manufacturing/work-centers/[id]`): Full CrudForm. Shows linked operations count ("Used by N operations across M routings") as read-only info.

### Factory Zones

**Path:** `/backend/manufacturing/factory-zones`

**DataTable columns:** Name, Code, Active

**Create/Edit:** CrudForm dialog (simple — name, code, notes). No separate detail page needed (few fields).

### Units of Measure

**Path:** `/backend/manufacturing/units-of-measure`

**DataTable columns:** Code, Name, Type (piece/length/area/weight/volume/time), Active

**Create/Edit:** CrudForm dialog (code, name, type select, active toggle). No separate detail page needed.

## Catalog Widget Injection

**Injection spot:** `crud-form:catalog.product` (existing spot in catalog product detail)

**Widget:** `product_master.injection.catalog-manufacturing-link`

**Behavior:**
- Checks if ProductManufacturingExtension exists for this product (via API or enricher data)
- **If no extension:** Shows "Enable Manufacturing" button. On click: creates ProductManufacturingExtension with defaults → redirects to `/backend/manufacturing/products/[id]`
- **If extension exists:** Shows "View Manufacturing Data →" link. Navigates to `/backend/manufacturing/products/[id]`

**Placement:** kind='group', column 2, below SEO widget (priority < 50)

## Graceful Incompleteness in UI

All UI follows the Graceful Incompleteness principle from the parent spec:

### Empty States

| Location | Empty State |
|---|---|
| BOM tab, no BOM | "No bill of materials defined. Create BOM →" with add button |
| Routing tab, no routing | "No routing defined. Create routing →" with add button |
| Configurator tab, no attributes | "No configuration attributes defined. Add attribute →" with add button |
| Production methods, none | "No production methods. Add production method →" |
| Dependencies section, none | "No dependencies defined. Operations will follow sequence order." |

### Incomplete Data Indicators

| Data State | Display |
|---|---|
| BomLine with null material_id | Row with "Material not selected" placeholder, warning icon |
| BomLine with null quantity | "—" in quantity column, tooltip "Quantity not set" |
| Operation with null work_center | "No work center" in work center column, warning icon |
| Operation with null run_time | "—" in time column, tooltip "Time not set — will be treated as 0 in calculations" |
| Variant condition with unknown key | Warning badge on row: "Unknown key: seat_type" |
| PM with no BOM linked | "No BOM" in BOM column, neutral style (not error) |
| PM with no routing linked | "No routing" in routing column, neutral style |

### Validation Behavior

- **Save:** Always succeeds. No required-completeness gates on any form.
- **Explode BOM:** Returns partial results + warnings panel. Does not refuse to run on incomplete data.
- **Time rollup:** Returns partial results + warnings. Null times treated as 0.
- **Config resolution:** Returns partial results + errors (blocking: invalid combos) + warnings (non-blocking: missing attributes, forced changes).

## Implementation Plan

### Dependency Graph

```
Phase 1 (List + Catalog Widget)
  └─→ Phase 3 (Detail Shell)
       └─→ Phase 4 (Configurator Tab)
            ├─→ Phase 5 (BOM Tab)
            └─→ Phase 6 (Routing Tab)

Phase 2 (Master Data) ← independent, but must complete before Phase 5+6
                         (BOM needs UoM picker, Routing needs WorkCenter picker)

Phase 7 (Seed Data) ← after all phases

Pre-requisite: create packages/manufacturing/AGENTS.md before Phase 1
               (use create-agents-md skill)
```

### Pre-requisite: AGENTS.md

Create `packages/manufacturing/AGENTS.md` using the `create-agents-md` skill. Covers: module structure (4 modules), entity ownership, cross-module FK conventions, API route prefix convention, UI page nesting convention, migration playbook reference. Must exist before implementation agents work on the package.

### Phase 1: Navigation + Product List + Catalog Widget

1. Update sidebar menu widget: add sub-items (Products, Work Centers, Factory Zones, Units of Measure)
2. Create product list page: DataTable with enricher-sourced columns
3. Create product picker dialog: catalog product DataTable with extension exclusion filter
4. Wire "Add Product" flow: create extension → redirect
5. Catalog widget injection: "Enable Manufacturing" / "View Manufacturing Data →" in catalog product detail
6. Product list row click: link to `/backend/manufacturing/products/[id]` — page returns 404 until Phase 3 (acceptable — link is wired, target built next)

**Testable outcome:** Navigate to Manufacturing → Products. See product list. Add a catalog product to manufacturing. Enable manufacturing from catalog product page.

### Phase 2: Master Data Pages

1. Work centers list + detail page
2. Factory zones list + dialog CRUD
3. Units of measure list + dialog CRUD

**Testable outcome:** Full CRUD on all three master data entities via dedicated pages. Must complete before Phase 5+6 — BOM tab needs UoM picker, Routing tab needs work center picker.

**Can run in parallel with Phase 3** — no dependency between master data pages and detail shell.

### Phase 3: Product Detail Shell + Overview Tab

**Depends on:** Phase 1 (product list links to detail page)

1. Create product detail page with `DetailTabsLayout`
2. Create `FormHeader` with product name, SKU, procurement type badge, "Edit in Catalog →" action
3. Overview tab: read-only product identity, editable manufacturing fields, production method list
4. Readiness checklist component — initially shows: manufacturing enabled ✓, base UoM ✓, PM count ✓, BOM ○, routing ○, configurator ○ (updated as tabs land in later phases)
5. Production method cards: show "No BOM" / "No routing" placeholders — linked names wired when BOM+routing tabs land

**Testable outcome:** Click product in list → tabbed detail page. Edit manufacturing fields. See readiness checklist. Create/edit production methods.

### Phase 4: Configurator Tab

**Depends on:** Phase 3 (tab shell)

1. ConfigAttribute DataTable with CRUD dialogs
2. ConstraintRule DataTable with CRUD dialogs (condition/action editors)
3. Resolution preview panel with dynamic attribute form
4. Conditional tab visibility (rule_based only, message for variant_based, hidden for none)
5. Update overview tab readiness checklist: configurator ○ → ✓ when attributes exist

**Testable outcome:** Configure attributes and rules. Test resolution. Attributes defined here provide the namespace for variant_condition keys in BOM and routing tabs.

### Phase 5: BOM Tab

**Depends on:** Phase 3 (tab shell), Phase 4 (namespace validation), Phase 2 (UoM picker)

1. BOM tree component: hierarchical expandable list with line data
2. BOM line CRUD: add/edit/delete dialogs with material picker (catalog product combobox), UoM picker (from Phase 2 master data), variant condition editor (validates keys against ConfigAttribute.key from Phase 4)
3. BomLineVariant inline expandable section
4. BOM explosion panel: adaptive config/variant input → async job → result table + warnings
5. Update overview tab: readiness checklist BOM ○ → ✓ when BOM lines exist. Production method cards show linked BOM name (click → switches to BOM tab)

**Testable outcome:** View BOM tree. Add/edit lines with validated variant conditions and UoM selection. Expand variant overrides. Run explosion and see results. Overview reflects BOM status.

### Phase 6: Routing Tab

**Depends on:** Phase 3 (tab shell), Phase 4 (namespace validation), Phase 2 (work center picker)

**Can run in parallel with Phase 5** — both depend on Phases 2+3+4 but not on each other.

1. Operations DataTable with inline CRUD
2. Work center combobox with "Create new" dialog shortcut (master data pages from Phase 2 provide the data)
3. OperationTemplateVariant inline expandable section (variant condition keys validated against configurator attributes from Phase 4)
4. Flow visualization (read-only, topological sort rendered as indented tree)
5. Dependency list with add/delete + cycle detection
6. Time rollup panel
7. Update overview tab: readiness checklist routing ○ → ✓ when operations exist. Production method cards show linked routing name (click → switches to Routing tab)

**Testable outcome:** View operations. Add operations with work center selection. See flow visualization. Define dependencies. Calculate time rollup. Overview reflects routing status.

### Phase 7: Seed Data

**Depends on:** All phases (seeds create data across all entities)

1. Add minimal `seedExamples` to product_master `setup.ts`: one "Example Assembly" product with extension, 1 PM, basic BOM (3 lines), basic routing (3 operations, 2 dependencies), 3 work centers, 1 factory zone
2. For rule_based example: add 3 ConfigAttributes + 2 ConstraintRules

**Testable outcome:** Fresh app shows example manufacturing data after initialization. All tabs populated with example data.

## Integration Test Scenarios

Tests in `packages/manufacturing/src/modules/*/__ integration__/`. Playwright API-first + UI navigation.

### Coverage — API Routes

| Route | Method(s) | Covered by |
|---|---|---|
| `/api/product_master/manufacturing/product-manufacturing-extension` | GET / POST / PUT / DELETE | #1, #2, #7, #8, #24 |
| `/api/product_master/manufacturing/catalog-products?enrolled=true\|false` | GET | #1 (picker `enrolled=false`), #7 (list `enrolled=true`), #24 |
| `/api/product_master/manufacturing/unit-of-measure` | GET / POST / PUT / DELETE | #6 |
| `/api/product_master/manufacturing/production-method` | GET / POST / PUT / DELETE | #9, #24 |
| `/api/routing/work-center` | GET / POST / PUT / DELETE | #4 |
| `/api/routing/factory-zone` | GET / POST / PUT / DELETE | #5 |
| `/api/catalog/products` (via `catalog-products` join) | GET | #1, #7 (indirect; covered by the catalog-products join endpoint) |

### Coverage — UI Paths

| Path | Covered by |
|---|---|
| `/backend/manufacturing/products` | #1, #7, #24 |
| `/backend/manufacturing/products/[id]` (Overview tab) | #2, #7, #8, #9, #24 |
| `/backend/manufacturing/work-centers` | #4 |
| `/backend/manufacturing/work-centers/[id]` | #4 |
| `/backend/manufacturing/factory-zones` | #5 |
| `/backend/manufacturing/units-of-measure` | #6 |
| `/backend/manufacturing` (dashboard redirect → products) | #1 (implicit via first navigation) |
| Catalog product detail widget (`crud-form:catalog.product` spot) | #2 |

### Scenarios

| ID | Phase | Scenario | Validates |
|---|---|---|---|
| 1 | 1 | Navigate to Manufacturing → Products → see empty list → click "Add Product" → select catalog product → verify extension created → redirected to detail page | Product onboarding flow, picker dialog, extension auto-creation |
| 2 | 1 | Open catalog product detail → click "Enable Manufacturing" → verify extension created → redirected to manufacturing detail | Catalog widget injection, cross-module navigation |
| 3 | 1 | Open manufacturing product → click "Edit in Catalog →" → verify navigates to catalog product detail | Cross-module navigation |
| 4 | 2 | Navigate to Work Centers → create work center → edit → verify in list | Master data CRUD |
| 5 | 2 | Navigate to Factory Zones → create factory zone → verify in list | Master data CRUD |
| 6 | 2 | Navigate to Units of Measure → create UoM → verify in list | Master data CRUD |
| 7 | 3 | Open manufacturing product detail → verify tabs render → Overview tab shows product identity + manufacturing fields + readiness checklist (all ○ for new product) | Detail shell, tab layout, overview content, Graceful Incompleteness empty states |
| 8 | 3 | Edit manufacturing fields (procurement type, config type, base UoM, phantom default) → save → verify persisted | Extension field editing |
| 9 | 3 | Create production method → verify in overview list → set as default | PM CRUD in overview tab |
| 10 | 4 | Open configurator tab (set config type to rule_based first) → create config attribute (each type: enum, boolean, material) → verify dynamic form renders type-appropriate inputs | Configurator attribute CRUD, ConfigurationForm component |
| 11 | 4 | Create constraint rule (require_value type) → run resolution preview → verify rule fires and forced value shown in warnings | Constraint rule CRUD, resolution engine |
| 12 | 4 | Set config type to variant_based → verify configurator tab shows "manage variants in Catalog" message | Conditional tab visibility |
| 13 | 5 | Open BOM tab → see empty state ("No BOM defined") → create BOM header → add BOM lines → verify tree renders | BOM CRUD, empty state, Graceful Incompleteness |
| 14 | 5 | Add BOM line with null material_id → verify "Material not selected" placeholder with warning icon → save succeeds | Graceful Incompleteness — save with incomplete data |
| 15 | 5 | Reorder BOM lines via up/down buttons → verify sort_order updated | Reorder without drag-and-drop |
| 16 | 5 | Product with no variants/config → run explosion → verify just button + date picker (no variant input form) → result shows all lines | Adaptive explosion panel — simplest case |
| 17 | 5 | Product with rule_based config → run explosion → verify attribute form renders → resolve + explode → correct lines filtered | Adaptive explosion panel — rule_based case |
| 18 | 5 | BOM with variant_condition referencing unknown ConfigAttribute key → verify warning badge on line | Namespace validation warning |
| 19 | 6 | Open routing tab → see empty state → create operation with work center (combobox) → verify in list | Routing CRUD, empty state, work center picker |
| 20 | 6 | Create operation with null run_time → verify "—" display with tooltip | Graceful Incompleteness — null times |
| 21 | 6 | Add 3+ operations → add dependencies → verify flow visualization renders with parallel paths and convergence | Flow visualization |
| 22 | 6 | Attempt to add circular dependency → verify rejection error in dialog | Cycle detection |
| 23 | 6 | Run time rollup → verify result with per-operation breakdown + warnings for null times | Time rollup with incomplete data |
| 24 | 5+6 | Full flow: create product → add PM → BOM with lines → routing with operations → link PM → verify overview readiness all ✓ → PM cards show linked BOM/routing names | End-to-end vertical slice, readiness checklist update |

## Risks & Impact Review

#### Catalog Enricher Performance on Product List
- **Scenario**: Product list page fetches catalog product data (name, SKU) via enricher for every row. At 50 products per page, enricher makes cross-package queries
- **Severity**: Medium
- **Affected area**: Product list page load time
- **Mitigation**: Enricher already implements `enrichMany` with batch loading (sub-spec a). Product list uses standard DataTable pagination (pageSize ≤ 100). No readiness computation on list page — only boolean flags and counts already available from existing enricher
- **Residual risk**: First page load after cache invalidation. Acceptable

#### Product Picker Dialog Query
- **Scenario**: "Add Product" picker needs to show catalog products WITHOUT manufacturing extension. Requires fetching all extension product_ids to build exclusion list
- **Severity**: Low
- **Affected area**: Picker dialog performance at scale (1000+ products)
- **Mitigation**: Query extension table for product_ids (single indexed query), pass as exclusion filter to catalog API. Catalog API supports ID exclusion via query params. Paginated picker (pageSize ≤ 50)
- **Residual risk**: Very large catalogs (10K+ products) may need server-side exclusion join. Acceptable for initial implementation

##### Picker at scale
- **Current implementation**: `/api/product_master/manufacturing/catalog-products?enrolled=false` loads every enrolled product id into a JS `Set`, then passes the whole set as a `{ id: { $nin: [...] } }` clause on the `CatalogProduct` query. Statement size is linear in the enrolled-product count, and every unique exclusion list churns the PostgreSQL query-plan cache
- **Scale limit**: Comfortable up to ~1k enrolled products per tenant (exclusion list fits in a single ~40 KB statement and query-plan cache stays healthy)
- **Follow-up**: Past the 1k threshold, switch the picker branch to a server-side anti-join — either a raw `NOT EXISTS (SELECT 1 FROM manufacturing_product_extensions ...)` subquery against the tenant-scoped table via `em.getKnex()`, or push the exclusion into a custom CRUD filter path so MikroORM generates the subquery itself
- **Inline marker**: the branch in `catalog-products/route.ts` carries a `TODO(scale)` comment that points back to this note so future reviewers can find the decision trail

#### Cross-Module Tab Content
- **Scenario**: Product detail page shell is in product_master module, but BOM tab content is in bom module, routing in routing module, configurator in configurator module. Tab components must be imported cross-module within the same package
- **Severity**: Low
- **Affected area**: Module boundaries, code organization
- **Mitigation**: Within `packages/manufacturing`, modules can import each other's components. Tab components exported from each module and imported by the product_master detail page. Same package = same build, no circular dependency risk as imports are one-directional (shell imports tabs, not reverse)
- **Residual risk**: None — standard pattern within a package

#### Inline CRUD Complexity
- **Scenario**: BOM tab has tree + expandable variant overrides + explosion panel. Many interactive elements on one page
- **Severity**: Medium
- **Affected area**: UI complexity, user confusion, state management
- **Mitigation**: Progressive disclosure: tree collapsed by default, variant overrides hidden behind expand arrow, explosion panel collapsible. Each section manages its own loading/error state independently. Standard OM patterns (CrudForm dialogs, DataTable, flash messages) keep interaction consistent
- **Residual risk**: Power users with complex BOMs (50+ lines, many variants) may find the page busy. Future: consider split BOM tree into own page for very complex products

## Final Compliance Report — 2026-04-05

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Widget injection via widgets/injection/ + injection-table.ts | Compliant | Catalog link widget uses existing crud-form:catalog.product spot. Sidebar menu widget already exists |
| root AGENTS.md | ACL features check | Compliant | Per-entity sub-namespaces: `product_master.view` for products/UoM, `bom.view` for BOM tab, `routing.view` for routing tab, `routing.work_center.view\|manage` for work center pages, `routing.factory_zone.view\|manage` for factory zone pages, `configurator.view` for configurator tab. `routing.factory_zone.*` was added in the 2026-04-11 code-review round to stop the factory-zones page guard (`routing.view`) diverging from the factory-zone API guard (`routing.work_center.view`) — see F1 in that round's review notes. |
| packages/ui AGENTS.md | Use CrudForm for create/edit | Compliant | Dialogs and edit forms use CrudForm. Detail page uses DetailTabsLayout |
| packages/ui AGENTS.md | Use DataTable for lists | Compliant | Product list, operations, attributes, rules, work centers, factory zones, UoM all use DataTable |
| packages/ui AGENTS.md | apiCall/apiCallOrThrow, never raw fetch | Compliant | All API calls via apiCall |
| packages/ui AGENTS.md | useT() for all strings | Compliant | All labels, messages, empty states use i18n keys |
| packages/ui AGENTS.md | LoadingMessage/ErrorMessage for states | Compliant | Each tab/section handles loading/error independently |
| packages/ui AGENTS.md | Button/IconButton, never raw button | Compliant | All interactive elements use OM button components |
| packages/ui AGENTS.md | Cmd+Enter submit, Escape cancel on dialogs | Compliant | All CrudForm dialogs follow standard shortcuts |
| packages/ui AGENTS.md | flash() for CRUD feedback | Compliant | Success/error messages via flash after all write operations |
| packages/ui AGENTS.md | useGuardedMutation for non-CrudForm writes | Compliant | Extension creation in picker, production method actions use guarded mutations |
| packages/ui AGENTS.md | pageSize ≤ 100 | Compliant | All DataTables configured with pageSize ≤ 100 |
| packages/ui/backend AGENTS.md | Stable id values on RowActions | Compliant | edit, delete, open used consistently |
| packages/ui/backend AGENTS.md | NotFound as dedicated page state | Compliant | Product detail page handles missing product/extension with ErrorMessage + "Back to list" |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Pages use correct ACL features from sub-specs a–d | Pass | `product_master.view`, `bom.view`, `routing.view`, `routing.work_center.view\|manage`, `routing.factory_zone.view\|manage` (added 2026-04-11), `configurator.view`. Page guard, menu widget feature gate, and API route `requireFeatures` align for every master data entity |
| API endpoints referenced match sub-spec contracts | Pass | All CRUD and custom endpoints from sub-specs a–d |
| Graceful Incompleteness applied consistently | Pass | Every tab has empty states, every nullable field has placeholder display |
| Navigation structure matches sidebar widget | Pass | 4 sidebar items → 4 page paths |

### Verdict

**Fully compliant** — ready for implementation.

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Pre-req — AGENTS.md | Done | 2026-04-06 | `packages/manufacturing/AGENTS.md` created |
| Phase 1 — Navigation + Product List + Catalog Widget | Done | 2026-04-06 | Sidebar menu with sub-items, product list DataTable, product picker dialog, catalog injection widget |
| Phase 2 — Master Data Pages | Done | 2026-04-06 | Work centers list+detail, factory zones list+dialog, UoM list+dialog |
| Phase 3 — Product Detail Shell + Overview Tab | Done | 2026-04-06 | ManufacturingTabsLayout, FormHeader, Overview tab with fields/PM/readiness. BOM/Routing/Configurator tabs render placeholder bodies until their phases land |
| Phase 4 — Configurator Tab | Not Started | — | — |
| Phase 5 — BOM Tab | Not Started | — | — |
| Phase 6 — Routing Tab | Not Started | — | — |
| Phase 7 — Seed Data | Not Started | — | Deferred to follow-up — requires running DB with tenant |

---

## Changelog

### 2026-04-06
- **Implementation**: Phases 1-3 implemented. Typecheck and build pass. BOM/Routing/Configurator tabs render placeholder bodies until their respective phases land.

### 2026-04-05
- Initial spec. Product list + tabbed detail (Overview, BOM, Routing, Configurator) + 3 master data pages + catalog widget injection + sidebar navigation. 7-phase implementation plan. Graceful Incompleteness UI patterns. Seed data hook
