# Manufacturing Product Foundation — b: Bill of Materials

| Field | Value |
|-------|-------|
| **Status** | In Progress |
| **Created** | 2026-04-04 |
| **Parent spec** | `2026-04-03-manufacturing-product-foundation.md` |
| **Mode** | External Extension (`packages/manufacturing`, module `bom`) |
| **Depends on** | Sub-spec a (product_master module — ProductionMethod, UnitOfMeasure) |
| **Sub-specs** | This is sub-spec **b** of 4 (a: Product Master, b: BOM, c: Routing, d: Configurator) |

---

## TLDR

**Key Points:**
- Add a `bom` module within `packages/manufacturing` for multi-level Bill of Materials with phantom pass-through, date-effective lines, variant-conditional activation, and scrap tracking
- 3 new entities: BomHeader, BomLine, BomLineVariant
- BOM explosion algorithm: recursive, async (queue worker), handles phantom BOMs, variant conditions, date-effective filtering, and BomLineVariant overrides
- Configuration resolution = stub/passthrough in this sub-spec — real implementation in sub-spec d (configurator)
- Widget injection: BOM tab in product detail page (into slot registered by product_master module)

**Scope:**
- Module: `src/modules/bom/` with full auto-discovery
- 3 entities with ORM relations within the module (BomHeader ↔ BomLine ↔ BomLineVariant)
- CRUD API + async explosion endpoint
- BOM explosion worker (`workers/bom-explode.ts`)
- Pure explosion algorithm in `lib/bom-explosion.ts` (unit-testable, no DB dependency)
- BOM tree visualization widget
- Cycle detection on save, max depth on explosion

**Concerns:**
- BOM explosion is the most algorithmically complex feature in the manufacturing package — heavy unit test coverage required
- `BomLine.operation_template_id` is a nullable UUID FK to the routing module's OperationTemplate — null until sub-spec c lands
- variant_condition JSONB keys must match ConfigAttribute names (namespace rule) — enforced at application level, not DB

---

## Overview

A Bill of Materials defines what materials and sub-assemblies go into a manufactured product. This module implements multi-level BOM with three variant mechanisms that can operate simultaneously:

1. **Separate child BOMs** — when variants differ in most materials (e.g., two backrest sizes with completely different components)
2. **Variant conditions on lines** — when variants share most materials but differ in specific components (e.g., different seat front: padded roll vs flat)
3. **BomLineVariant overrides** — when a variant needs a different quantity or material for the same BOM position (e.g., extra fabric for models with cushions)

The BOM explosion algorithm recursively flattens a multi-level BOM into a flat material list, handling phantom pass-through, date-effective lines, and all three variant mechanisms.

> **Market Reference**: Multi-level BOM with phantom follows SAP/Epicor pattern. Three-level variant mechanism exceeds most mid-market systems (Odoo has only variant_condition equivalent via `bom.byproduct` apply_on filter; no BomLineVariant override). Date-effective lines follow NetSuite/Acumatica pattern. Phantom on BomHeader (not Product) follows Odoo `mrp.bom.type='phantom'` and ERPNext `BOM.is_phantom_bom` — validated against 13 reference systems.

## Problem Statement

1. **No BOM entity in OM.** The catalog has products, variants, and bundles (`CatalogProductVariantRelation`) — but bundles are flat (A = 2B + 1C) with no multi-level hierarchy, no phantom logic, no date-effective lines, no variant-conditional activation, no scrap tracking.

2. **Variant complexity requires three mechanisms.** Real manufactured products have variants at different levels of the product hierarchy, with different patterns of divergence. A single variant mechanism (e.g., just options on a product) cannot handle "backrest sizes are completely different BOMs" AND "seat front varies by one component" AND "fabric quantity depends on cushion option."

3. **BOM explosion is needed for MRP, costing, and purchasing.** Without a flattened material list per variant/configuration, there's no way to calculate costs, plan material purchases, or generate work orders.

## Proposed Solution

Add a `bom` module within `packages/manufacturing` with three entities (BomHeader, BomLine, BomLineVariant), a recursive explosion algorithm, and a BOM tree UI widget.

### Design Decisions

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 1 | Phantom flag placement | **BomHeader.is_phantom, not Product** | Same product can be phantom in one context (MTO flow) and non-phantom in another (MTS buffer). Authoritative flag on BOM allows per-context control. Product-level flag kept as UX default for initial BOM creation (parent spec decision #5) |
| 2 | BOM explosion mode | **Async via queue worker** | Explosion of deep BOMs with many variants can take seconds. Async prevents API timeout. Returns job ID, progress tracked via OM's progress module |
| 3 | Cycle detection | **On save (reject) + on explosion (max depth)** | Save-time detection prevents most cycles. Max depth (default 10) catches edge cases from concurrent edits. Explosion returns error, never hangs |
| 4 | Configuration resolution | **Stub in this sub-spec, real in sub-spec d** | BOM explosion step 0 (resolve config snapshot → variant condition keys) is a passthrough until the configurator module exists. Explosion accepts pre-resolved variant conditions as input |
| 5 | variant_condition format | **JSONB with AND semantics** | Keys = attribute names, values = arrays of matching values. All keys must match (AND). Supports negation via `{"key": {"not": ["value"]}}`. Keys validated against ConfigAttribute names at application level (namespace rule) |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Flat BOM (single level) | Cannot represent sub-assemblies, phantom pass-through, or per-level variant divergence |
| Separate variant BOM copies | Data duplication — shared materials repeated in every variant copy. Unmaintainable at 500+ fabric variants × 8 seat types |
| JSONB for BOM structure | Cannot query, index, or join on individual lines. Anti-pattern confirmed by Odoo experience |
| Synchronous explosion API | Deep BOMs with many variants can take seconds. Sync = API timeout risk |

## Data Models

### BomHeader

One per product or sub-assembly. Linked to ProductionMethod (from product_master module) by UUID FK.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `product_id` | UUID | NOT NULL | — | FK to CatalogProduct (cross-package, UUID) — which product/sub-assembly this BOM is for |
<!-- production_method_id REMOVED — PM owns the FK to BomHeader, not the reverse. Query PM→BOM via ProductionMethod.bom_header_id. See review finding #4. -->
| `name` | VARCHAR(255) | NOT NULL | — | Human label (e.g., "Main BOM", "Seat assembly BOM") |
| `bom_usage` | VARCHAR(20) | NOT NULL | 'production' | Distinguishes BOM purpose. Values: 'production', 'packaging'. VARCHAR (not ENUM) for extensibility — future usage types (e.g., 'engineering', 'costing') don't require migration. Application-level validation via Zod |
| `is_phantom` | BOOLEAN | NOT NULL | false | Phantom BOM: components pass through to parent during explosion. No separate work order or inventory. Authoritative flag (not inherited from Product) |
| `is_active` | BOOLEAN | NOT NULL | true | Soft toggle — inactive BOMs excluded from explosion |
| `version` | INTEGER | NOT NULL | 1 | Version number for change tracking |
| `notes` | TEXT | nullable | null | — |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Indexes:** `(organization_id, product_id, is_active)` for active BOM lookup.

### BomLine

One material or child BOM reference per line. ORM relation to parent BomHeader.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `bom_header_id` | UUID | NOT NULL | — | FK to BomHeader (ORM relation — same module) |
| `line_type` | ENUM('material','semi_product') | NOT NULL | 'material' | Material = raw material/component. Semi-product = reference to child BOM |
| `material_id` | UUID | nullable | null | FK to CatalogProduct (cross-package, UUID). The material or sub-assembly. Nullable per Graceful Incompleteness — line can be created as placeholder |
| `child_bom_header_id` | UUID | nullable | null | FK to BomHeader (ORM relation — same module). For semi_product lines — which child BOM to recurse into. Null for material lines |
| `net_quantity` | NUMERIC(18,4) | nullable | null | Net material quantity (without waste). Nullable — can be filled in later |
| `gross_quantity` | NUMERIC(18,4) | nullable | null | Gross quantity including scrap. Computed: net_quantity / (1 - scrap_percentage/100). Nullable when net_quantity is null |
| `scrap_percentage` | NUMERIC(5,2) | NOT NULL | 0 | Expected waste percentage. Used to compute gross_quantity from net_quantity |
| `uom_id` | UUID | nullable | null | FK to UnitOfMeasure (cross-module, UUID). Unit for quantities. Nullable per Graceful Incompleteness |
| `variant_condition` | JSONB | nullable | null | Activation condition: which variant/configuration this line applies to. Null = always active (common line). Format: `{"attribute_name": ["value1", "value2"]}` — all keys must match (AND). Negation: `{"key": {"not": ["value"]}}` |
| `operation_template_id` | UUID | nullable | null | FK to OperationTemplate (cross-module, UUID). Which routing operation consumes this material. Nullable — wired when routing module (sub-spec c) lands |
| `sort_order` | INTEGER | NOT NULL | 0 | Display ordering in BOM tree |
| `valid_from` | DATE | nullable | null | Date-effective start. Null = no start constraint |
| `valid_to` | DATE | nullable | null | Date-effective end. Null = no end constraint |
| `is_consumable` | BOOLEAN | NOT NULL | false | Consumable material used across multiple operations (e.g., glue, staples). Affects inventory reservation strategy |
| `notes` | TEXT | nullable | null | — |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Indexes:** `(bom_header_id, sort_order)` for ordered line listing. `(organization_id, material_id)` for "where-used" queries (which BOMs use this material). `(bom_header_id, valid_from, valid_to)` for date-effective filtering.

### BomLineVariant

Per-variant override on a BOM line. Overrides quantity, material, or unit for a specific variant/configuration.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `bom_line_id` | UUID | NOT NULL | — | FK to BomLine (ORM relation — same module) |
| `variant_id` | UUID | nullable | null | FK to CatalogProductVariant (cross-package, UUID). For variant_based products. **XOR with variant_condition** |
| `variant_condition` | JSONB | nullable | null | For rule_based products. Same format as BomLine.variant_condition. **XOR with variant_id** |
| `quantity_override` | NUMERIC(18,4) | nullable | null | Override net_quantity. Null = use base line quantity |
| `material_override_id` | UUID | nullable | null | FK to CatalogProduct (cross-package, UUID). Override material. Null = use base line material |
| `unit_override_id` | UUID | nullable | null | FK to UnitOfMeasure (cross-module, UUID). Override unit. Null = use base line unit |
| `notes` | TEXT | nullable | null | — |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Constraints:**
- DB CHECK: `(variant_id IS NOT NULL AND variant_condition IS NULL) OR (variant_id IS NULL AND variant_condition IS NOT NULL)` — XOR enforcement (parent spec decision #4)
- Application-enforced (Zod): same XOR rule + variant_condition key validation against ConfigAttribute names

**Indexes:** `(bom_line_id, variant_id)` for variant_based lookup. `(bom_line_id)` for listing all overrides per line.

## BOM Explosion Algorithm

Recursive algorithm that flattens a multi-level BOM into a flat material list. Lives in `lib/bom-explosion.ts` as a pure function (no DB dependency — receives data, returns result). Executed async via queue worker.

### Input

```typescript
type ExplosionInput = {
  bomHeaderId: string
  variantConditions: Record<string, string[]>  // resolved config keys → values
  effectiveDate: Date                           // for date-effective line filtering
  maxDepth?: number                             // default: 10
}
```

### Algorithm (5 steps)

1. **Configuration resolution** (stub) — In this sub-spec, `variantConditions` are passed in directly. Sub-spec d replaces this with resolution from ConfigAttribute values (ConstraintRule evaluation deferred).

2. **Filter BomLines** — For each line in the BomHeader:
   - Skip if `is_active = false` on parent BomHeader
   - Skip if `valid_from > effectiveDate` or `valid_to < effectiveDate` (date-effective)
   - Skip if `variant_condition` is set and doesn't match `variantConditions` (all keys must match — AND semantics)
   - Skip if `deleted_at` is set
   - This step handles two variant mechanisms at once: (a) **variant conditions on material lines** — individual components included/excluded per variant, and (b) **separate child BOMs per variant** — semi_product lines pointing to different child BOMs, each with its own variant_condition. Only the child BOM matching the current variant survives filtering; the rest are skipped. Step 4 then recurses into the surviving child.

3. **Apply BomLineVariant overrides** — For each active line, find matching BomLineVariant:
   - For `variant_based`: match by `variant_id`
   - For `rule_based`: match by `variant_condition` against `variantConditions`
   - If match found: apply `quantity_override`, `material_override_id`, `unit_override_id` (null fields = keep base value)

4. **Phantom pass-through** — If line references a child BOM (`line_type = 'semi_product'`, `child_bom_header_id` is set):
   - Load child BomHeader
   - If `child.is_phantom = true`: recurse into child, merge resulting lines into current level (components float up)
   - If `child.is_phantom = false`: add child as a sub-assembly line in result (separate work order in future phases)

5. **Recurse** — For non-phantom child BOMs, recurse steps 2-4. Track depth, abort at `maxDepth` with error.

### Output

```typescript
type ExplosionResult = {
  lines: ExplosionLine[]
  warnings: string[]        // e.g., "Line L-123 has null material_id — skipped"
  depth: number             // max depth reached
}

type ExplosionLine = {
  bomLineId: string
  materialId: string | null
  quantity: number           // after override
  uomId: string | null
  scrapPercentage: number
  grossQuantity: number
  operationTemplateId: string | null
  level: number              // 0 = top level, 1 = first child, etc.
  isPhantomPassThrough: boolean  // true if this line came from a phantom BOM
  sourceBomHeaderId: string      // which BOM this line originated from
}
```

### Cycle Detection

- **On save**: when creating/updating a BomLine with `child_bom_header_id`, traverse the child BOM's children recursively to check if any reference the current BomHeader. Reject with validation error if cycle detected.
- **On explosion**: depth counter increments per recursion level. If `depth > maxDepth`, abort with error (not hang). Default maxDepth = 10 (configurable per request).

### Variant Condition Matching

```
// Format examples:

// Single attribute — line active when seat type is one of listed values
{"seat_type": ["SD01", "SD02", "SD03"]}

// Multiple attributes — ALL must match (AND)
{"seat_type": ["SD04"], "fabric_group": ["premium", "standard"]}

// Negation — line active for all seat types EXCEPT SD04
{"seat_type": {"not": ["SD04"]}}
```

Matching logic: for each key in `variant_condition`, check if the corresponding key in `variantConditions` input has at least one matching value. For negation, check that no values match. All keys must satisfy (AND). Missing key in input = no match (line skipped).

## API Contracts

All routes under `/api/manufacturing/`. CRUD routes use `makeCrudRoute` with `openApi` export.

**Route prefix convention:** Route files nested under `api/manufacturing/` to achieve `/api/manufacturing/` prefix (e.g., `api/manufacturing/bom/route.ts` → `/api/manufacturing/bom`). See sub-spec a for rationale.

### BOM Header

- `GET /api/manufacturing/bom` — List (filtered by product_id, bom_usage, is_active)
- `GET /api/manufacturing/bom/:id` — Detail (includes nested BomLines and BomLineVariants)
- `POST /api/manufacturing/bom` — Create
- `PUT /api/manufacturing/bom/:id` — Update
- `DELETE /api/manufacturing/bom/:id` — Soft delete

### BOM Line

- `GET /api/manufacturing/bom-line` — List (filtered by bom_header_id)
- `GET /api/manufacturing/bom-line/:id` — Detail
- `POST /api/manufacturing/bom-line` — Create (with cycle detection if child_bom_header_id set)
- `PUT /api/manufacturing/bom-line/:id` — Update (with cycle detection if child_bom_header_id changed)
- `DELETE /api/manufacturing/bom-line/:id` — Soft delete

### BOM Line Variant

- `GET /api/manufacturing/bom-line-variant` — List (filtered by bom_line_id)
- `GET /api/manufacturing/bom-line-variant/:id` — Detail
- `POST /api/manufacturing/bom-line-variant` — Create
- `PUT /api/manufacturing/bom-line-variant/:id` — Update
- `DELETE /api/manufacturing/bom-line-variant/:id` — Soft delete

### BOM Explosion

- `POST /api/manufacturing/bom/explode` — Async explosion. Queues worker, returns job ID.
  - Request: `{ bomHeaderId: string, variantConditions?: Record<string, string[]>, effectiveDate?: string, maxDepth?: number }`
  - Response: `{ jobId: string }` (202 Accepted)
  - Progress tracked via OM's progress module
  - Result retrievable via progress endpoint when job completes

### Where-Used Query

- `GET /api/manufacturing/bom/where-used?materialId=:uuid` — Lists all BomHeaders that contain a given material (direct or via child BOMs). Useful for impact analysis.

## Commands & Events

### Commands

| Command | Entity | Undo |
|---|---|---|
| `bom.bom_header.create` | BomHeader | Delete created record |
| `bom.bom_header.update` | BomHeader | Restore previous field values |
| `bom.bom_header.delete` | BomHeader | Restore soft-deleted record |
| `bom.bom_line.create` | BomLine | Delete created record |
| `bom.bom_line.update` | BomLine | Restore previous field values |
| `bom.bom_line.delete` | BomLine | Restore soft-deleted record |
| `bom.bom_line_variant.create` | BomLineVariant | Delete created record |
| `bom.bom_line_variant.update` | BomLineVariant | Restore previous field values |
| `bom.bom_line_variant.delete` | BomLineVariant | Restore soft-deleted record |

### Events

```typescript
const events = [
  { id: 'bom.bom_header.created', label: 'BOM Created', entity: 'bom_header', category: 'crud' },
  { id: 'bom.bom_header.updated', label: 'BOM Updated', entity: 'bom_header', category: 'crud' },
  { id: 'bom.bom_header.deleted', label: 'BOM Deleted', entity: 'bom_header', category: 'crud' },
  { id: 'bom.bom_line.created', label: 'BOM Line Created', entity: 'bom_line', category: 'crud' },
  { id: 'bom.bom_line.updated', label: 'BOM Line Updated', entity: 'bom_line', category: 'crud' },
  { id: 'bom.bom_line.deleted', label: 'BOM Line Deleted', entity: 'bom_line', category: 'crud' },
  { id: 'bom.bom_line_variant.created', label: 'BOM Line Variant Created', entity: 'bom_line_variant', category: 'crud' },
  { id: 'bom.bom_line_variant.updated', label: 'BOM Line Variant Updated', entity: 'bom_line_variant', category: 'crud' },
  { id: 'bom.bom_line_variant.deleted', label: 'BOM Line Variant Deleted', entity: 'bom_line_variant', category: 'crud' },
  { id: 'bom.explosion.completed', label: 'BOM Explosion Completed', entity: 'bom_header', category: 'lifecycle' },
] as const
```

Note: `bom.explosion.completed` is a lifecycle event (not CRUD) — emitted when async explosion completes. Payload includes `bomHeaderId`, `lineCount`, `depth`, `warningCount`.

## ACL Features

```typescript
export const features = [
  { id: 'bom.view', title: 'View bills of materials', module: 'bom' },
  { id: 'bom.create', title: 'Create bills of materials', module: 'bom' },
  { id: 'bom.update', title: 'Update bills of materials', module: 'bom' },
  { id: 'bom.delete', title: 'Delete bills of materials', module: 'bom' },
  { id: 'bom.explode', title: 'Run BOM explosion', module: 'bom' },
]
```

Default role features:
```typescript
defaultRoleFeatures: {
  admin: ['bom.*'],
  employee: ['bom.view'],
}
```

## Implementation Plan

### Phase A: Entities + CRUD

1. Create `src/modules/bom/` with: `index.ts`, `acl.ts`, `events.ts`, `setup.ts`, `di.ts`, `search.ts`, `translations.ts`
2. Create `data/entities.ts` with BomHeader, BomLine, BomLineVariant (MikroORM, ORM relations within module)
3. Create `data/validators.ts` with Zod schemas (including XOR validation on BomLineVariant)
4. Create `translations.ts` declaring translatable fields: BomHeader.name
5. Create `search.ts` with searchConfig for BomHeader (by name, product)
6. DB CHECK constraint on BomLineVariant: variant_id XOR variant_condition
7. Run `yarn db:generate` and `yarn db:migrate`
8. Create CRUD routes for: bom, bom-line, bom-line-variant. All entity queries use `findWithDecryption`/`findOneWithDecryption` per OM convention
9. Cycle detection on BomLine create/update when child_bom_header_id is set. Use `withAtomicFlush` to ensure cycle-detection query sees current state before flush
10. Where-used query endpoint (single-level: returns direct BomHeader references only, not recursive child traversal — recursive where-used is a future enhancement)
11. Hand-write migrations by extracting `bom_*` statements from `db:generate` output (known db:generate bug for external packages — see migration playbook)

**Testable outcome:** Full CRUD on all 3 entities. Cycle detection rejects circular references. Where-used query returns results.

### Phase B: Explosion Algorithm + Worker

1. Create `lib/bom-explosion.ts` — pure function, no DB dependency
2. Create `workers/bom-explode.ts` — queue worker that loads data (via `findWithDecryption`), calls explosion function, stores result via ProgressService
3. Create `api/bom/explode.ts` — async endpoint, queues job, returns job ID
4. Wire progress tracking: resolve `ProgressService` from DI container. Call `createJob()` at start, `updateProgress()` per recursion level (indeterminate — status messages, not percentage), `completeJob()` with result or `failJob()` on error. **Verify early** that ProgressService is accessible from external package worker context
5. Handle phantom pass-through in recursion
6. Handle date-effective filtering
7. Handle variant_condition matching (AND semantics, negation)
8. Handle BomLineVariant overrides
9. Config resolution = passthrough (accept variantConditions as input, no ConfigAttribute resolution)

**Testable outcome:** Explosion endpoint accepts request, returns job ID. Worker processes explosion, result available via progress endpoint.

### Phase C: UI Widget + Tests

**Depends on:**
- `2026-04-05-manufacturing-ui-foundation.md` Phase 3 (tab shell, `ManufacturingTabsLayout`, detail page)
- `2026-04-05-manufacturing-ui-foundation.md` Phase 2 (UnitOfMeasure master data page — BOM lines pick UoM from here)
- Sub-spec d Phase C (`useConfigAttributeKeys` hook — used for variant_condition key validation)

#### 1. BomTab component

- **Location**: `packages/manufacturing/src/modules/bom/components/BomTab.tsx` (exported and consumed by the product detail page from `2026-04-05-manufacturing-ui-foundation.md`)
- **Props**: `{ productId: string; extension: ProductManufacturingExtension }`
- **ACL feature**: `bom.view` for reads, `bom.create`/`bom.update`/`bom.delete` for writes, `bom.explode` for explosion

#### 2. BOM header selector

Two modes, user-togglable:

- **Auto-resolve** (default): when the user provides config/variant in the explosion panel, the tab calls `POST /api/manufacturing/production-method/resolve` to find the best PM for the product, then uses its linked `bom_header_id`. User doesn't manually pick a BOM
- **Manual override**: dropdown showing all BomHeaders for this product (production + packaging usage). For power users or when auto-resolution returns no match

#### 3. BOM tree view

Hierarchical expandable tree: BomHeader → BomLines. Empty state: "No bill of materials defined. Create BOM →" with primary button that opens the BomHeader create dialog.

Each line row displays:

| Field | Display |
|---|---|
| Material | Product name (link to catalog product detail) or "Material not selected" placeholder with warning icon |
| Line type | Badge: `material` / `semi_product` |
| Quantity | `net_qty (gross_qty)` or "—" if null |
| UoM | Code from `unit_of_measure` lookup or "—" |
| Scrap % | Percentage or "0%" |
| Variant condition | Badge with key summary (e.g., "seat_type: SD01, SD02") or empty. Warning badge "Unknown key: X" when key is not in `useConfigAttributeKeys(productId)` |
| Operation | Linked operation name or "—" |
| Date range | `valid_from – valid_to` or "Always" |
| Consumable | Flag icon if true |
| Phantom | Ghost icon on child BomHeader rows where `is_phantom=true` |

**Row actions** (stable ids): `edit`, `delete`, `reorder-up`, `reorder-down`

**Reorder** uses `sort_order` increment/decrement via API. No drag-and-drop library in OM — explicit up/down buttons on each row.

#### 4. BOM line CRUD dialogs

**Add Material / Add Sub-assembly** header buttons → `CrudForm` dialog with:

- Material picker: catalog product combobox (`/api/catalog/products` filtered by type) — required nullable per Graceful Incompleteness
- Line type (select: `material` / `semi_product`)
- Quantity net / gross (both nullable)
- UoM picker: searchable combobox of UnitOfMeasure (master data from foundation spec Phase 2) with "Create new" shortcut → dialog
- Scrap %
- Variant condition editor: JSON object editor or key-value row editor. On save, validates keys against `useConfigAttributeKeys(productId)` — unknown keys produce a warning (non-blocking per Graceful Incompleteness)
- Operation linker: combobox of OperationTemplate names for the routing template(s) linked to this product
- Valid from / valid to (date pickers)
- Consumable flag
- Phantom flag (only when `line_type='semi_product'` with a `child_bom_header_id`)

Save always succeeds — null material_id produces a warning badge on the row, not a save error.

#### 5. BomLineVariant inline section

Expand arrow on any BomLine reveals a nested rows area containing BomLineVariant overrides for that line. Each override row shows:

- Variant identifier (CatalogProductVariant name or raw `variant_condition` keys)
- Quantity override (or "—")
- Material override (or "—")
- Unit override (or "—")

**Inline actions**: add override (dialog), edit (dialog), delete (confirm). Add dialog enforces the XOR constraint from the entity spec — exactly one of `catalog_product_variant_id` or `variant_condition` must be set.

#### 6. BOM explosion panel

**Adaptive form** — the explosion input UI adapts to what's defined. The "Explode BOM" button always works, even with incomplete data.

**Configuration input switching** — the panel renders one of three input components based on `configuration_type`:

| `configuration_type` | Input Component | Output passed to explosion |
|---|---|---|
| `none` | Nothing — just "Explode BOM" button + effective date picker | `{}` — all lines always active |
| `variant_based` | `VariantPicker` — CatalogProductVariant combobox (`/api/catalog/products/[productId]/variants`) + effective date | `{ catalogProductVariantId }` — matches BomLineVariant.catalog_product_variant_id |
| `rule_based` | `ConfigurationForm` (from sub-spec d §3) + effective date | `{ variantConditions }` — calls configurator resolve first, then passes resolved conditions to explosion |

**`VariantPicker` component**: simple searchable combobox of CatalogProductVariant records for this product. Located at `packages/manufacturing/src/modules/product_master/components/VariantPicker.tsx`. Shared by BOM explosion (this spec) and routing time rollup (sub-spec c §7).

**Edge cases per state:**

| Product State | Behavior |
|---|---|
| `variant_based`, no BomLineVariants exist | Picker still shown with note "No variant-specific overrides defined — all variants produce the same material list" |
| `variant_based`, BomLines have `variant_condition` values not matching any CatalogProductVariant option | Warning "N lines reference variant values not found in product variants" |
| `rule_based`, ConfigAttributes defined, BomLines have `variant_condition` keys not in `useConfigAttributeKeys(productId)` | Warning "N lines reference unknown configuration keys" with list of orphaned keys |
| `rule_based`, no ConfigAttributes yet | Just button + effective date + message "No configuration attributes defined — explosion will include all unconditional BOM lines." Conditional lines skipped, warning shown in result |
| Any type, BomLines have variant_conditions but no configurator/variants | Just button + effective date + warning "N lines have variant conditions but no configuration provided — conditional lines will be skipped" |

- Effective date picker defaults to today, shown in all states for date-effective line filtering
- **Submit flow**: "Explode BOM" button wrapped in `useGuardedMutation` (non-CrudForm write). On click: calls `POST /api/manufacturing/bom-header/explode` → returns `{ jobId }`. Then `useOperationProgress(jobId)` polls for completion (or SSE when DOM Event Bridge is wired). On success, renders result. On error, shows flash error. `useGuardedMutation` provides `retryLastMutation` in injection context for retry support.
- **Result display:**
  - **Flat material list**: material name, quantity, UoM, gross quantity, level, source BOM
  - **Warnings panel** (collapsible): "2 lines skipped: null material_id", "3 conditional lines skipped: no configuration provided", etc.

#### 7. Readiness checklist integration

Expose `useIsBomReady(productId): boolean` — returns `true` when at least one BomHeader with at least one non-soft-deleted BomLine exists for the product. Foundation overview tab calls this to flip BOM ○ → ✓.

Also expose `useBomName(productId): { name: string | null; ready: boolean }` for the production method cards on the overview tab to display linked BOM names.

#### 8. Unit tests

Already completed as part of Phase B algorithm work (`lib/bom-explosion.ts` — 16 tests, validators — 12 tests, cycle detection — 6 tests, variant matching — 8 tests). No additional unit tests required for the UI layer.

#### 9. Integration tests

Tests in `packages/manufacturing/src/modules/bom/__integration__/bom-tab.spec.ts`. Playwright, API-first setup + UI navigation.

| ID | Scenario | Validates |
|---|---|---|
| B-UI-1 | Open product detail with no BOM → verify BOM tab shows "No bill of materials defined" empty state → click "Create BOM" → create BomHeader → verify tree renders | Empty state, BomHeader create, Graceful Incompleteness |
| B-UI-2 | Add BomLine with null material_id → verify row saves successfully → verify "Material not selected" placeholder with warning icon on display | Graceful Incompleteness — save with incomplete data |
| B-UI-3 | Add 3 BOM lines → reorder via up/down buttons → verify `sort_order` updated and display order reflects change | Reorder without drag-and-drop |
| B-UI-4 | Open BomLine edit dialog → set variant_condition with an unknown key (not in ConfigAttributes) → verify warning badge on row after save → save succeeds | Namespace validation warning (non-blocking) |
| B-UI-5 | Product with `configuration_type='none'`, no variant conditions → click "Explode BOM" → verify explosion panel shows only button + date picker → result shows all lines | Adaptive explosion panel — simplest case |
| B-UI-6 | Product with `configuration_type='rule_based'`, 3 ConfigAttributes (from sub-spec d) → explode → verify `ConfigurationForm` renders → fill + resolve + explode → correct lines filtered | Adaptive explosion panel — rule_based case, integration with sub-spec d UI |
| B-UI-7 | Add BomLineVariant override on existing BomLine → expand arrow → verify override row renders → edit quantity override → verify persisted | BomLineVariant inline CRUD |
| B-UI-8 | Create child BomHeader with `is_phantom=true`, reference from parent BomLine → explode parent → verify phantom children merged flat into result | Phantom pass-through in explosion result |
| B-UI-9 | Product with `configuration_type='variant_based'`, BomLineVariants exist → open explosion panel → verify variant picker (CatalogProductVariant select) + effective date → select variant → explode → correct overrides applied | Adaptive explosion panel — variant_based case |
| B-UI-10 | Product with `configuration_type='rule_based'`, no ConfigAttributes defined → open explosion panel → verify just button + date + "No configuration attributes defined" message → explode → result includes only unconditional lines, conditional lines skipped with warning | Adaptive explosion panel — rule_based with no attributes |
| B-UI-11 | Product with BomLines having variant_conditions but `configuration_type='none'` → open explosion panel → verify warning "N lines have variant conditions but no configuration provided" → explode → conditional lines skipped | Adaptive explosion panel — orphaned conditions |

**Testable outcome:** BOM tab visible in product detail. Add/edit lines with validated variant conditions and UoM selection. Expand variant overrides. Run explosion in all 5 adaptive panel states and see results. Overview tab reflects BOM readiness. All unit and integration tests pass.

## Risks & Impact Review

#### Explosion Performance on Deep BOMs
- **Scenario**: BOM with 4+ levels, 500+ variant combinations, date-effective lines on every level. Explosion takes >10 seconds
- **Severity**: Medium
- **Affected area**: Explosion worker, MRP (future)
- **Mitigation**: Async worker (no API timeout). Explosion is pure function — can be profiled and optimized independently. Index on `(bom_header_id, valid_from, valid_to)` for date filtering. Batch-load all BomLines per BomHeader (not N+1 per line). Max depth limit prevents runaway recursion
- **Residual risk**: Very deep BOMs (10+ levels) with many variants could be slow. Acceptable — manufacturing BOMs rarely exceed 4-5 levels. Max depth = 10 as safety net

#### Concurrent Edits Creating Cycles
- **Scenario**: User A adds line A→B, user B simultaneously adds line B→A. Neither triggers cycle detection individually, but together they create a cycle
- **Severity**: Low
- **Affected area**: Data integrity
- **Mitigation**: Save-time cycle detection catches most cases. Explosion-time max depth catches the rest — explosion returns error listing the cycle path (e.g., "Circular reference: BOM A → BOM B → BOM A"). User resolves by removing or changing the child_bom_header_id on one of the offending lines. No silent infinite loop
- **Residual risk**: Brief window where invalid data exists until next explosion or validation request. Acceptable — the cycle doesn't corrupt other data, it just blocks explosion until fixed

#### variant_condition Key Drift
- **Scenario**: ConfigAttribute is renamed or deleted, but BomLine.variant_condition still references the old key name. Explosion silently skips the line (no match)
- **Severity**: Medium
- **Affected area**: BOM explosion correctness
- **Mitigation**: Namespace validation at application level — when saving BomLine with variant_condition, validate keys against existing ConfigAttribute names. Warn (not block) if ConfigAttribute doesn't exist yet (Graceful Incompleteness — config may not be defined yet). Sub-spec d (configurator) will add stricter enforcement
- **Residual risk**: If ConfigAttribute is renamed after BomLines reference it, existing variant_conditions become stale. Future: ECM module will handle this via ChangeOrder impact analysis when implemented

#### Inline CRUD Complexity in BOM Tab
- **Scenario**: BOM tab has tree + expandable variant overrides + adaptive explosion panel with warnings. Many interactive elements on one page
- **Severity**: Medium
- **Affected area**: UI complexity, user confusion, state management
- **Mitigation**: Progressive disclosure — tree collapsed by default, variant overrides hidden behind expand arrow, explosion panel collapsible. Each section manages its own loading/error state independently. Standard OM patterns (CrudForm dialogs, DataTable, flash messages) keep interaction consistent
- **Residual risk**: Power users with complex BOMs (50+ lines, many variants) may find the page busy. Future: split BOM tree into own page for very complex products

#### Incomplete BOM Data
- **Scenario**: BOM exists with lines that have null material_id, null quantities, or no lines at all. User requests explosion
- **Severity**: Low
- **Affected area**: Explosion result
- **Mitigation**: Per Graceful Incompleteness principle. Explosion skips lines with null material_id (adds warning to result). Lines with null quantity treated as 0. Empty BOM returns empty result with warning "BOM has no active lines." No error thrown — partial results are valid
- **Residual risk**: None — this is the intended design

## Final Compliance Report — 2026-04-04

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/queue/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | ORM relations only within bom module (BomHeader↔BomLine↔BomLineVariant). Cross-module refs (material_id, operation_template_id) use UUID strings. PM→BOM link owned by ProductionMethod, not BomHeader |
| root AGENTS.md | Filter by organization_id | Compliant | All entities have organization_id + tenant_id |
| root AGENTS.md | Validate inputs with Zod | Compliant | data/validators.ts with XOR validation on BomLineVariant |
| root AGENTS.md | API routes MUST export openApi | Compliant | Via makeCrudRoute + explode endpoint with explicit openApi |
| root AGENTS.md | Write operations via Command pattern | Compliant | 9 commands with undo contracts |
| root AGENTS.md | Event IDs: module.entity.action (singular) | Compliant | bom.bom_header.created, bom.bom_line.updated, etc. Module name as prefix per OM convention |
| root AGENTS.md | DB schema ADDITIVE-ONLY | Compliant | All new tables |
| root AGENTS.md | Widget spot IDs FROZEN once created | Compliant | Injects into existing product_master spot, no new spots |
| root AGENTS.md | ACL feature IDs FROZEN once created | Compliant | New features (bom.*) |
| packages/core AGENTS.md | setup.ts: declare defaultRoleFeatures | Compliant | admin: bom.*, employee: bom.view |
| packages/core AGENTS.md | Translatable fields in translations.ts | Compliant | BomHeader.name |
| packages/queue AGENTS.md | Workers must be idempotent | Compliant | Explosion worker produces result from input — rerunnable |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | 3 CRUD resources + explode + where-used match 3 entities |
| API contracts match UI/UX section | Pass | BOM tree widget consumes CRUD + explosion APIs |
| Risks cover all write operations | Pass | CRUD, explosion, cycle detection, concurrent edits |
| Commands defined for all mutations | Pass | 9 commands with undo |
| Cache strategy covers all read APIs | N/A | No caching in this module — explosion is async, CRUD is standard |

### Verdict

**Fully compliant** — ready for implementation.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — Entities + CRUD | Done | 2026-04-04 | 3 entities, 9 commands, 3 CRUD routes, where-used endpoint, cycle detection, migration |
| Phase B — Explosion + Worker | Done | 2026-04-04 | Pure explosion algorithm, async queue worker with ProgressService, explode endpoint |
| Phase C — Widget + Tests | In Progress | 2026-04-04 | Algorithm + unit tests done (44 tests). BOM tab placeholder landed in foundation spec Phase 3. Detailed BomTab UI migrated into this spec (2026-04-11 refactor) — implementation not started |
| Review fixes | Done | 2026-04-06 | Removed production_method_id from BomHeader entity/validator/command/route. Added 3 bom_line_variant CRUD events. Migration regenerated |

---

## Changelog

### 2026-04-11
- **Phase C expansion**: Migrated detailed BOM tab UI spec from `2026-04-05-manufacturing-ui-foundation.md` (foundation UI spec refactor). Added BomTab component contract, BOM header selector modes, tree view layout, line CRUD dialogs, BomLineVariant inline section, adaptive explosion panel (5 states), readiness hook exports (`useIsBomReady`, `useBomName`), and 8 integration tests (B-UI-1..8). Phase C status: Done (placeholder only) → In Progress. Declared dependencies on foundation Phase 3 + Phase 2 (UoM) + sub-spec d Phase C (`useConfigAttributeKeys`).

### 2026-04-06
- Review fixes: removed production_method_id from BomHeader (FK direction reversal — PM owns bom_header_id). Added bom_line_variant CRUD events. Status → In Progress

### 2026-04-04
- Pre-implementation analysis fixes: added Phase 0 (multi-module package registration prerequisite), API route prefix verification note, findWithDecryption + withAtomicFlush in CRUD/cycle detection, ProgressService DI verification note, where-used clarified as single-level, bom_usage changed from ENUM to VARCHAR for extensibility, hand-write migrations note
- Initial sub-spec. 3 entities (BomHeader, BomLine, BomLineVariant). BOM explosion algorithm (5-step, async, with phantom/date-effective/variant handling). 3-phase implementation plan. Follows patterns from sub-spec a (commands, events, ACL, Graceful Incompleteness)
