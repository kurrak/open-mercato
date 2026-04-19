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
| 4 | Configuration resolution | **Stub in this sub-spec, real in sub-spec d** | The input `variantConditions` arrive pre-resolved as a passthrough until the configurator module exists; sub-spec d replaces this with ConstraintRule evaluation over ConfigAttribute values. The algorithm itself does not include a numbered "resolve config" step — resolution happens upstream of the 5 explosion steps |
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
| `product_id` | UUID | nullable | null | FK to CatalogProduct (cross-package, UUID). The material or sub-assembly. Null in two cases: (a) Graceful Incompleteness — line created as placeholder; (b) dynamic mode — `product_resolve_key` is set and the concrete product is resolved at explosion time into the result output, never into this persisted column |
| `product_variant_id` | UUID | nullable | null | FK to CatalogProductVariant (cross-package, UUID). **Static mode**: optional — the user may pin a specific variant at design time when the chosen Product has variants; null means "no specific variant / Product has no variants". **Dynamic mode**: always null on the persisted row; Step 2 writes the resolved ProductVariant into the explosion result only. Requires `product_id IS NOT NULL` when set |
| `product_resolve_key` | VARCHAR(100) | nullable | null | Dynamic resolution key matching `ConfigAttribute.key` on the master product. When set, the concrete Product/ProductVariant is resolved at explosion time (Step 2 type-directed lookup) from the UUID carried in `variantConditions[key]`, not stored on the master row. The matching ConfigAttribute's `attribute_type` decides the target table (`'product'` → CatalogProduct by id, `'product_variant'` → CatalogProductVariant by id). Use for configuration options where enumerating every possibility as a separate BomLine would be unmaintainable (e.g., hundreds of fabric options keyed by a single `fabric` configuration axis). Only valid for `line_type = 'material'` |
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

**Indexes:** `(bom_header_id, sort_order)` for ordered line listing. `(organization_id, product_id)` and `(organization_id, product_variant_id)` for "where-used" queries (which BOMs reference a given Product or ProductVariant — covers both static lines and product-pinned variants). `(bom_header_id, valid_from, valid_to)` for date-effective filtering. `(organization_id, product_resolve_key)` for diagnosing which lines resolve dynamically via a given configuration key.

**Constraints** (all application-enforced via Zod in `data/validators.ts` — no new DB CHECKs; this aligns with the Graceful Incompleteness philosophy, where violations should surface as actionable warnings rather than opaque Postgres errors, and matches the existing OM pattern of validating invariants in the app layer):

- Resolve-key vs. static product: `product_resolve_key IS NULL OR product_id IS NULL` — a line cannot be both statically referenced and dynamically resolved at design time.
- Resolve-key vs. static variant: `product_resolve_key IS NULL OR product_variant_id IS NULL` — dynamic lines never carry a persisted ProductVariant; Step 2 writes it into the explosion result only.
- Variant requires product: `product_variant_id IS NULL OR product_id IS NOT NULL` — a ProductVariant cannot be pinned without its parent Product.
- Resolve-key scope: `product_resolve_key IS NULL OR line_type = 'material'` — `semi_product` lines reference a fixed child BOM and cannot use dynamic resolution.
- Variant-product drift (Static mode): when `product_variant_id` is set, `product_variant.product_id === product_id` — the pinned ProductVariant must belong to the chosen Product.
- Namespace rule: when `product_resolve_key` is set, it should match an existing `ConfigAttribute.key` on the same master product. **Warning-only** per Graceful Incompleteness — the configurator may not be defined yet when the BOM is drafted.

**Authoring vs. runtime namespace (semi-products).** "Same master product" here means the product that **owns this BomHeader** — the authoring scope used to populate key suggestions in the UI editor. This is *not* the same as the runtime matching scope. At explosion time, `variantConditions` is the top-level configured master's snapshot and flows top-down through every child BomHeader unchanged (see §Algorithm Step 5 and §Variant Condition Matching). A `product_resolve_key` or `variant_condition` authored on a BomLine inside a semi-product's BOM is therefore matched against the consuming master's snapshot, not the semi-product's own ConfigAttributes. The two namespaces are expected to align for most real cases — semi-products are typically not configurable on their own — but when a user edits a semi-product's BOM tab in isolation, `useConfigAttributeKeys(semiProductId)` commonly returns an empty list. Free-text keys MUST therefore be allowed in the editor (with a non-blocking warning) because the consuming master is unknowable from a semi-product's page. See §Phase C §3 (shared VariantCondition components) for the UX contract and the Future Work note on a master-perspective viewer.

**Fallback behavior if an invariant is bypassed** (e.g., a migration or direct-SQL write sidesteps Zod): Step 2 detects the inconsistency, leaves `productId` null on the output line, and appends a warning to the explosion result. The row is surfaced in the UI (row with null `productId` whose master had `product_resolve_key` → rendered as unresolved) but excluded from planning. No hard error — same soft-error channel used for all other runtime resolution failures.

### BomLineVariant

Per-variant override on a BOM line. Overrides quantity, product (with optional variant), or unit for a specific variant/configuration.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `bom_line_id` | UUID | NOT NULL | — | FK to BomLine (ORM relation — same module) |
| `variant_id` | UUID | nullable | null | FK to CatalogProductVariant (cross-package, UUID). Identifies which configuration this override applies to in variant_based products. **XOR with variant_condition** |
| `variant_condition` | JSONB | nullable | null | For rule_based products. Same format as BomLine.variant_condition. **XOR with variant_id** |
| `quantity_override` | NUMERIC(18,4) | nullable | null | Override net_quantity. Null = use base line quantity |
| `product_override_id` | UUID | nullable | null | FK to CatalogProduct (cross-package, UUID). Override product. Null = use base line product (or base line's runtime-resolved product if the base uses `product_resolve_key`) |
| `product_variant_override_id` | UUID | nullable | null | FK to CatalogProductVariant (cross-package, UUID). Paired with `product_override_id` when the override pins a specific ProductVariant of the override Product. Null when the override Product has no variants or no specific variant is pinned. Requires `product_override_id IS NOT NULL` |
| `unit_override_id` | UUID | nullable | null | FK to UnitOfMeasure (cross-module, UUID). Override unit. Null = use base line unit |
| `notes` | TEXT | nullable | null | — |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Constraints:**
- DB CHECK (activation XOR, pre-existing): `(variant_id IS NOT NULL AND variant_condition IS NULL) OR (variant_id IS NULL AND variant_condition IS NOT NULL)` — exactly one activation mechanism (parent spec decision #4). Kept at the DB level because it is the original invariant of this entity and already shipped.
- Application-enforced (Zod) — no new DB CHECKs added for these:
  - The activation XOR above (same rule, belt-and-suspenders with the DB CHECK).
  - Variant override requires product override: `product_variant_override_id IS NULL OR product_override_id IS NOT NULL` — cannot pin a ProductVariant override without its Product override.
  - Variant-product drift: when `product_variant_override_id` is set, `product_variant_override.product_id === product_override_id` — the variant belongs to the override Product.
  - `variant_condition` key validation against `ConfigAttribute.key` values (warning-only per Graceful Incompleteness).

**Fallback behavior if an invariant is bypassed**: Step 3 skips a malformed override (e.g., `product_variant_override_id` set without `product_override_id` → no product override applied, warning appended to the result). No hard error — consistent with the rest of the explosion algorithm.

**Indexes:** `(bom_line_id, variant_id)` for variant_based lookup. `(bom_line_id)` for listing all overrides per line. `(organization_id, product_override_id)` and `(organization_id, product_variant_override_id)` extend "where-used" coverage to override references.

## BOM Explosion Algorithm

Recursive algorithm that flattens a multi-level BOM into a flat material list. Lives in `lib/bom-explosion.ts` as a pure function (no DB dependency — receives data, returns result). Executed async via queue worker.

### Input

```typescript
type ExplosionInput = {
  bomHeaderId: string
  variantConditions: Record<string, string>    // keys = ConfigAttribute.key; values = the customer's single selection for that key (a UUID for 'product' / 'product_variant' attribute types, the raw option string for 'enum' / 'boolean' / 'text' / 'numeric_range')
  effectiveDate: Date                          // for date-effective line filtering
  maxDepth?: number                            // default: 10
}
```

- **`variantConditions`** — the resolved configuration conditions, one selected value per attribute. A single map serves three purposes: filter BomLines (Step 1), drive dynamic product resolution (Step 2), and match BomLineVariant overrides (Step 3). For attributes with `attribute_type = 'enum'` / `'boolean'` / `'text'` / `'numeric_range'`, the value is the raw selected option. For attributes with `attribute_type = 'product'` or `'product_variant'`, the value is a UUID — respectively a `CatalogProduct.id` or a `CatalogProductVariant.id`. Flows top-down through child BOMs unchanged. Note the asymmetry with `BomLine.variant_condition` (the **filter** on a line, which uses `Record<string, string[] | {not: string[]}>` to express "active when the selection is any of these"): the filter needs arrays; the user's selection does not.
- **`effectiveDate`** — used for date-effective line filtering in Step 1.

**Pre-loaded context passed to the pure function.** The pure function in `lib/bom-explosion.ts` has no DB access. The explosion worker performs all data loads before calling it and passes the results alongside `ExplosionInput`:

- **BOM graph** — all BomHeaders, BomLines, and BomLineVariants reachable from `bomHeaderId` (transitive via `child_bom_header_id`, depth-limited by `maxDepth`). Already the pattern used by the original spec — listed here for completeness.
- **`configAttributesByKey`** — a `Map<string, ConfigAttribute>` built from the **top-level** master product's `ConfigAttribute` records (single query at the start of explosion). The same map is reused at every level of recursion: `product_resolve_key` on any BomLine, at any depth, resolves against this top-level map, matching the namespace rule that governs `variant_condition` keys.
- **`catalogProducts`** and **`catalogProductVariants`** — `Map<string, CatalogProduct>` / `Map<string, CatalogProductVariant>` pre-loaded by the worker. The worker scans the BOM graph for BomLines with `product_resolve_key` set and for BomLineVariants with `product_override_id` / `product_variant_override_id` set, collects the candidate UUIDs from `variantConditions` and override columns, and fetches the matching catalog rows in two batched queries. Static `product_id` / `product_variant_id` on BomLines and the override FKs are handled the same way. The pure function then uses `.get(uuid)` lookups (no DB) — see Step 2 pseudocode below.

### Algorithm (5 steps)

For each level of the BOM tree, in order:

1. **Filter BomLines.** For each line on the current BomHeader:
   - Skip if `is_active = false` on the parent BomHeader.
   - Skip if `valid_from > effectiveDate` or `valid_to < effectiveDate` (date-effective).
   - Skip if `variant_condition` is set and does not match `variantConditions` (all keys must match — AND semantics).
   - Skip if `deleted_at` is set.

   This step handles two variant mechanisms at once: (a) **variant conditions on material lines** — individual components included/excluded per variant; and (b) **separate child BOMs per variant** — `semi_product` lines pointing to different child BOMs, each with its own `variant_condition`. Only the child BOM matching the current variant survives; the rest are skipped. Step 4 then recurses into the surviving child.

   For each surviving line, build an `ExplosionLine` output record (see §Output). Static lines (`product_id` set on the master) inherit the master's `product_id` / `product_variant_id` into the output unchanged and skip Step 2. Dynamic lines (master has `product_resolve_key`) leave `productId` / `productVariantId` null on the output and are handed to Step 2. The explosion algorithm is a pure function — it never mutates any persisted BomLine row.

2. **Resolve dynamic products.** For every `ExplosionLine` whose BomLine has `product_resolve_key` set, resolve the concrete product using the pre-loaded `configAttributesByKey` map. The `attribute_type` on the matching ConfigAttribute determines which pre-loaded catalog map to read — no fallback lookup, no code-to-entity disambiguation:

   ```
   key  = bomLine.product_resolve_key                // e.g. "fabric"
   attr = configAttributesByKey.get(key)             // ConfigAttribute for the top-level master product
   uuid = variantConditions[key]                     // UUID, or undefined if unset

   IF attr IS NULL:
     queue warning "BomLine {id} — resolve key '{key}' has no matching ConfigAttribute on the master product"
     CONTINUE

   IF uuid IS NULL:
     queue warning "BomLine {id} — resolve key '{key}' has no selected value in variantConditions"
     CONTINUE

   IF attr.attribute_type == 'product':
     product = catalogProducts.get(uuid)
     IF product IS NOT NULL:
       line.productId        = product.id
       line.productVariantId = null
     ELSE:
       queue warning "BomLine {id} — CatalogProduct {uuid} not found"

   ELSE IF attr.attribute_type == 'product_variant':
     variant = catalogProductVariants.get(uuid)
     IF variant IS NOT NULL:
       line.productId        = variant.productId
       line.productVariantId = variant.id
     ELSE:
       queue warning "BomLine {id} — CatalogProductVariant {uuid} not found"

   ELSE:
     queue warning "BomLine {id} — resolve key '{key}' points at ConfigAttribute of type '{attr.attribute_type}', which cannot drive dynamic product resolution"
   ```

   Warnings are **queued** (attached to the line for now), not yet emitted to the explosion result. Step 3 may still fill in `productId` via a BomLineVariant override, in which case the queued warning is discarded. After Step 3, any still-queued warning is flushed into `result.warnings[]`.

   A line for which Step 2 could not set `productId` (and Step 3 does not override it) remains in the output with `productId = null`. The UI surfaces such lines by checking `productId === null` against the master's `product_resolve_key` (known from the master BomLine); planning consumers (MRP, purchasing, work orders) filter them out of demand totals. The result's `warnings[]` carries the specific failure reason keyed by `bomLineId`.

3. **Apply BomLineVariant overrides.** For each `ExplosionLine`, find a matching BomLineVariant:
   - For `variant_based`: match by `variant_id`.
   - For `rule_based`: match by `variant_condition` against `variantConditions`.

   If a match is found, apply in this order:
   - `quantity_override` (null = keep base).
   - `product_override_id` + `product_variant_override_id` as a pair — either both null (no product override), or `product_override_id` set with `product_variant_override_id` null (override to a Product without pinning a variant), or both set (override and pin a specific ProductVariant).
   - `unit_override_id` (null = keep base).

   **Precedence.** When the override writes product fields, it replaces any value produced by Step 2 (dynamic resolution) or inherited from the static master — **override wins**. If the override sets product fields on a line for which Step 2 queued a resolution warning, that warning is discarded (the line is no longer unresolved).

   After Step 3 completes for a level, flush any still-queued warnings (lines where Step 2 failed and no override fixed them) into `result.warnings[]`.

4. **Phantom pass-through.** If the line references a child BOM (`line_type = 'semi_product'`, `child_bom_header_id` is set):
   - Load the child BomHeader.
   - If `child.is_phantom = true`: recurse into the child, merge the resulting `ExplosionLine` records into the current level (components float up).
   - If `child.is_phantom = false`: add the child as a sub-assembly line in the result (separate work order in future phases).

5. **Recurse.** For non-phantom child BOMs, recurse Steps 1–4 with the same `variantConditions`, `effectiveDate`, and pre-loaded context maps (`configAttributesByKey`, `catalogProducts`, `catalogProductVariants`). The `configAttributesByKey` map is anchored to the **top-level** master product and is reused at every depth — child BOMs do not load their own ConfigAttributes, because `product_resolve_key` / `variant_condition` keys across the whole tree live in the top-level product's namespace (the Namespace Rule). Track depth; abort at `maxDepth` with an error.

### Output

```typescript
type ExplosionWarning = {
  bomLineId: string | null  // null for graph-level warnings (max depth, cycle, BOM not found / inactive); line.id otherwise
  message: string           // e.g., "line emitted with null product_id — excluded from planning totals"; "resolve key 'fabric' missing from variantConditions"; "BomLineVariant v-42 has product_variant_override_id without product_override_id — override skipped"
}

type ExplosionResult = {
  lines: ExplosionLine[]
  warnings: ExplosionWarning[]    // structured; consumers can call warningsByLineId(result) to group line-specific warnings by bomLineId
  depth: number                   // max depth reached
}

type ExplosionLine = {
  bomLineId: string
  productId: string | null              // post-override; inherits from master for Static mode, set by Step 2 or Step 3 for Dynamic mode; null when Static incomplete, or when Dynamic and Step 2/3 did not produce a product
  productVariantId: string | null       // post-override; null when no variant is pinned or when the resolved Product has no variants
  quantity: number                      // post-override
  uomId: string | null                  // post-override
  scrapPercentage: number
  grossQuantity: number
  operationTemplateId: string | null
  level: number              // 0 = top level, 1 = first child, etc.
  isPhantomPassThrough: boolean  // true if this line came from a phantom BOM
  sourceBomHeaderId: string      // which BOM this line originated from
}
```

Lines with `productId === null` are included in the result (not skipped) so the UI can surface them. The result's `warnings[]` array carries specific failure reasons keyed by `bomLineId`. To distinguish a Static placeholder ("product not selected") from a Dynamic unresolved line ("the user's snapshot didn't resolve to a product"), callers look up the master BomLine's `product_resolve_key`: present = dynamic unresolved, absent = static placeholder. Downstream planning consumers (MRP, purchasing, work-order creation) filter any `productId === null` line out of planning totals regardless of the underlying reason.

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

Matching logic: for each key in `variant_condition`, check that the input's single selected value for that key (`variantConditions[key]`) is contained in the filter's array (inclusive form) or is not contained (negation form). All keys must satisfy (AND). Missing key in input = no match (line skipped).

**Runtime namespace is the top-level master's, not the current BomHeader's.** The `variantConditions` snapshot is the configuration of the *top-level* product on which explosion was invoked; it flows top-down through every child BomHeader unchanged (see §Algorithm Step 5). A `BomLine.variant_condition` key authored inside a semi-product's BOM matches against the consuming master's snapshot, not the semi-product's own ConfigAttributes. This is deliberate — otherwise the matcher would need to re-scope per depth and key collisions between master and semi-product namespaces would become failure modes. Authoring-side implication: a user editing a semi-product's BOM tab in isolation cannot be shown a validated key scope (the consuming master is unknown), so the editor tolerates free-text keys with a non-blocking warning. See §BomLine Constraints and §Phase C §3.

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
  - Request: `{ bomHeaderId: string, variantConditions?: Record<string, string>, effectiveDate?: string, maxDepth?: number }`
  - Response: `{ jobId: string }` (202 Accepted)
  - Progress tracked via OM's progress module
  - Result retrievable via progress endpoint when job completes. Each `lines[]` entry carries `productId` / `productVariantId` (null when Step 2 could not resolve and no override filled them); `result.warnings[]` carries per-line failure reasons keyed by `bomLineId`

### Where-Used Query

- `GET /api/manufacturing/bom/where-used?productId=:uuid&productVariantId=:uuid` — Lists all BomHeaders that reference a given Product or ProductVariant. Matches on the master line's `product_id` / `product_variant_id` and on BomLineVariant's `product_override_id` / `product_variant_override_id`. `productVariantId` is optional — when omitted, matches at Product level only. Useful for impact analysis.

  **Scope note:** The query does **not** traverse dynamic `product_resolve_key` lines, because their concrete product is only resolved at explosion time against a configuration snapshot. Traversing resolve-key lines would require a snapshot parameter and effectively re-run explosion. A dedicated "resolve-key where-used" is deferred (see §Risks).

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

Single combobox listing every BomHeader for this product (production + packaging usage). The first active header — sorted by `created_at asc` — is selected by default; the user can switch to any other BomHeader to view / edit its lines. Inactive headers appear with an "inactive" suffix in their label.

The selector is rendered only when the product has more than one BomHeader; with a single header the tab shell skips the selector entirely to reduce chrome in the common case.

Snapshot-aware PM resolution (i.e. "pick the right BOM for the variant/config the user is about to explode") lives in the explosion panel (§7), not in this selector. The explosion panel calls `POST /api/manufacturing/production-method/resolve` with the user's inputs and uses the returned PM's `bom_header_id` directly — independent of the selector's current pick.

#### 3. Shared VariantCondition components

`variant_condition` values MUST NOT be exposed as raw JSON in any user-facing surface. All display and authoring goes through two shared components used by §4 (tree view row), §5 (BomLine CRUD dialog), and §6 (BomLineVariant inline section). Encapsulating read/write here means the UX can be polished later without touching every call site — the storage shape (`Record<string, string[] | { not: string[] }>`) is stable.

**`VariantConditionBadges` — display**
- Location: `packages/manufacturing/src/modules/bom/components/VariantConditionBadges.tsx`
- Props: `{ value: Record<string, string[] | { not: string[] }> | null; productId: string; compact?: boolean }`
- Renders one pill per key: `key: val1, val2` or `key: NOT val1`. Null / empty map → renders nothing.
- For keys whose matching ConfigAttribute has `attribute_type = 'product'` or `'product_variant'`, values are hydrated from UUID → display name via `useCatalogLookup` (see below). On hydration failure the badge falls back to the UUID with a warning tooltip.
- Keys that do not match any ConfigAttribute scoped to `productId` render with a muted/warning style and a tooltip: "Unknown key — matched against the consuming master's configuration at runtime." (see §BomLine Constraints and §Variant Condition Matching for why this is legitimate on semi-product BOMs.)

**`VariantConditionEditor` — authoring**
- Location: `packages/manufacturing/src/modules/bom/components/VariantConditionEditor.tsx`
- Props: `{ value; onChange; productId: string; disabled?: boolean }`
- Row-per-key builder with three cells + remove-row button. Add-row button at the bottom.
  - **Key cell**: combobox sourced from `useConfigAttributeKeys(productId)` with free-text fallback. Typing an unlisted key is permitted (Graceful Incompleteness + semi-product authoring semantics).
  - **Operator cell**: `in` / `not in` toggle — maps to the inclusive form (`["v1","v2"]`) or the negation form (`{not: ["v1","v2"]}`).
  - **Values cell** (adapts to `ConfigAttribute.attribute_type`):
    | attribute_type | Renderer | Stored values |
    |---|---|---|
    | `enum` | multi-select from `allowed_values` | raw option strings |
    | `boolean` | true/false checkbox group | `["true"]` / `["false"]` |
    | `numeric_range` | range-value multi-select | raw range strings |
    | `text` | tag input | raw strings |
    | `product` / `product_variant` | multi-select combobox scoped by the attribute's `product_filter_id` | UUIDs |
    | unknown (free-text key, no matching ConfigAttribute) | tag input + "Unknown key" warning badge | raw strings |
- Component state and `onChange` always use the typed `Record<string, string[] | { not: string[] }>` shape — never emits a JSON string.
- Save-time validation is warning-only: unknown keys produce a row-level warning badge, do not block submit.

**`useCatalogLookup` hook — UUID → display name resolution**
- Location: `packages/manufacturing/src/modules/bom/hooks/useCatalogLookup.ts`
- Signature: `useCatalogLookup(productIds: readonly string[], variantIds: readonly string[]) → { productsById, variantsById, loading, error }`
- Batches all UUIDs referenced across all rendered `VariantConditionBadges` / `VariantConditionEditor` instances in a single request pair:
  - `GET /api/catalog/products?ids=uuid1,uuid2,…`
  - `GET /api/catalog/variants?ids=uuid1,uuid2,…`
- Cached via React Query at the component mount scope. Missing IDs fall through silently — badges render a UUID + warning tooltip.

**Semi-product authoring semantics.** On a semi-product's BOM tab, `useConfigAttributeKeys(productId)` commonly returns `[]`. The editor MUST still allow arbitrary keys (the consuming master is unknowable from this page). A rendered "Unknown key" warning on the row signals "this will be matched against the consuming master's snapshot at runtime" — not a save error. Future work: a "view as master X" perspective picker on the semi-product detail page (tracked in §Risks *Semi-Product Authoring Key Scope*).

#### 4. BOM tree view

Recursive expandable tree: the selected top-level `BomHeader` renders its lines; each `line_type='semi_product'` line with a `child_bom_header_id` is a drill-in point that reveals the child header's lines nested in place. Empty state: "No bill of materials defined. Create BOM →" with primary button that opens the BomHeader create dialog.

**Column layout** (left-to-right):

| # | Column | Display |
|---|---|---|
| 1 | Expand | ▶/▼ only on `semi_product` rows with a non-null `child_bom_header_id`. Empty cell otherwise. Clicking fetches the child header's lines and renders them nested with `depth + 1` indent. Cycle guard: if a `child_bom_header_id` already appears in the current branch's ancestor chain, the arrow is rendered muted with a "Cycle detected" tooltip and expansion is blocked |
| 2 | Product | Static lines: Product name (with ProductVariant name appended when `product_variant_id` is pinned) linked to catalog product detail, or "Product not selected" placeholder with warning icon when both `product_id` and `product_resolve_key` are null. Dynamic lines: resolve-key badge (e.g., `⟶ fabric`); the runtime-resolved product name appears only in the explosion result panel (see §7). Nested rows are indented by `depth * 16px` in this column |
| 3 | Line type | Badge: `material` / `semi_product` |
| 4 | Quantity | `net_qty (gross_qty)` or "—" if null |
| 5 | UoM | Code from `unit_of_measure` lookup or "—" |
| 6 | Scrap % | Percentage or "0%" |
| 7 | Variant condition | `VariantConditionBadges` (see §3). **Master-perspective scope**: nested child rows use the **top-level master's `productId`** for the badge's scope argument (not the child header's owning product) — this matches explosion-time matcher semantics (see §BomLine Constraints + §Variant Condition Matching). Unknown keys render muted with a tooltip |
| 8 | Operation | Linked operation name or "—" |
| 9 | Date range | `valid_from – valid_to` or "Always" |
| 10 | Flags | Consumable flag icon (C) / phantom-child ghost icon (on `semi_product` rows whose referenced child BomHeader has `is_phantom=true`) |
| 11 | Variants | `+ Add` button (always visible, scoped to the current row's `bom_line_id`). When the line has ≥ 1 `BomLineVariant`, also shows `[N]` count badge + ▶/▼ toggle. Clicking ▼ reveals the inline variants section (see §6) as a full-width detail row under this line |
| 12 | Actions | `edit` / `delete` row actions + reorder `up` / `down` icons (scoped to the parent header of the row — nested rows reorder within their own BomHeader, not across headers) |

**In-tree add affordance.** After the last real line of each rendered BomHeader (top-level and every expanded child), the tree renders a dashed muted pseudo-row: `[+ Add line]`. Clicking it opens the §5 BomLine CRUD dialog scoped to that `bomHeaderId`. This lets users add lines at any depth with one uniform gesture — there is no separate toolbar "Add material" / "Add sub-assembly" button; the dialog's `lineType` select covers both. Empty BomHeader → the pseudo-row is the only row, copy becomes "+ Add first line".

**Row actions** (stable ids): `edit`, `delete`, `reorder-up`, `reorder-down`.

**Reorder** uses `sort_order` increment/decrement via API. No drag-and-drop library in OM — explicit up/down icons on each row. Reordering is scoped to the row's parent BomHeader — a nested child line can only move within its own header's ordering.

#### 5. BOM line CRUD dialogs

**Entry points.** The dialog is opened from two places: (a) the in-tree `[+ Add line]` pseudo-row of any rendered BomHeader (see §4) — passes the owning `bomHeaderId`; (b) a row's `edit` action — passes the line being edited. There is no separate toolbar "Add material" / "Add sub-assembly" button; the dialog's `lineType` select covers both.

`CrudForm` dialog with:

- **Resolution mode** (segmented toggle): `Static` (default) vs `Dynamic`. Mutually exclusive — switches which product inputs render below. Dynamic mode is disabled when `line_type = 'semi_product'` (resolve key is material-only)
- **When Static:**
  - Product picker: CatalogProduct combobox (`/api/catalog/products`) — nullable per Graceful Incompleteness
  - Optional ProductVariant picker: CatalogProductVariant combobox filtered by the chosen `product_id` (`/api/catalog/products/[productId]/variants`). Hidden when the chosen Product has no variants. Cleared automatically when the user changes the Product to one with a different variant set
- **When Dynamic:**
  - Resolve-key picker: searchable combobox of `ConfigAttribute.key` values for the master product, restricted to attributes with `attribute_type = 'product'` or `attribute_type = 'product_variant'`. Unknown keys produce a warning badge (Graceful Incompleteness allows BOM to be drafted before the configurator is defined)
  - Static product + variant pickers are disabled and cleared to satisfy the XOR constraint
- Line type (select: `material` / `semi_product`)
- Quantity net / gross (both nullable)
- UoM picker: searchable combobox of UnitOfMeasure (master data from foundation spec Phase 2) with "Create new" shortcut → dialog
- Scrap %
- Variant condition: `VariantConditionEditor` (see §3). Per-type value renderers for enum/boolean/numeric_range/text/product/product_variant. Unknown keys allowed with non-blocking warning (Graceful Incompleteness + semi-product authoring semantics)
- Operation linker: combobox of OperationTemplate names for the routing template(s) linked to this product
- Valid from / valid to (date pickers)
- Consumable flag
- Phantom flag (only when `line_type='semi_product'` with a `child_bom_header_id`)

Save always succeeds for incomplete data — a Static row with null `product_id` or a Dynamic row with an unknown resolve key produces a warning badge on the row, not a save error. Save is blocked only for constraint violations (e.g., Static ProductVariant that does not belong to the chosen Product).

#### 6. BomLineVariant inline section

The §4 tree view's **Variants column** hosts both the add affordance (`+ Add`) and the toggle (`[N] ▶/▼` when overrides exist). Clicking ▼ opens a full-width detail row under the line containing the BomLineVariant overrides for that line. Each override row shows:

- Variant identifier (CatalogProductVariant name or `VariantConditionBadges` on the override's `variant_condition` — see §3)
- Quantity override (or "—")
- Product override (or "—") — when set, renders as `Product name` + appended ProductVariant name if `product_variant_override_id` is also set
- Unit override (or "—")

**Inline actions**: add override (dialog), edit (dialog), delete (confirm). The add/edit dialog enforces two constraints: (a) exactly one of `catalog_product_variant_id` or `variant_condition` must be set (activation XOR — when the user picks `variant_condition`, the dialog renders a `VariantConditionEditor` instead of the variant picker); (b) the Product + ProductVariant override pair — the dialog renders a Product picker and, when a Product is chosen, an optional ProductVariant picker filtered to variants of that Product. Both override fields clear together on reset, and the ProductVariant picker is hidden when the chosen Product has no variants. Validation: `product_variant_override.product_id === product_override_id` (drift guard).

#### 7. BOM explosion panel

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
- **Submit flow**: "Explode BOM" button wrapped in `useGuardedMutation` (non-CrudForm write). On click: calls `POST /api/manufacturing/bom/explode` → returns `{ jobId }`. Then `useOperationProgress(jobId)` polls for completion (or SSE when DOM Event Bridge is wired). On success, renders result. On error, shows flash error. `useGuardedMutation` provides `retryLastMutation` in injection context for retry support.
- **Result display:**
  - **Flat material list**: product name (+ variant name when present), quantity, UoM, gross quantity, level, source BOM, and a `Resolution` column showing `static` / `resolved (key)` / **`unresolved (key)`** per row. The column value is computed in the UI from the pair `(ExplosionLine.productId, master BomLine.product_resolve_key)` — no dedicated status field on the output. Unresolved rows (`productId === null` and master had a resolve key) are rendered with a muted/greyed style and a "Not in planning" badge so they are visible but not confused with planned demand
  - **Warnings panel** (collapsible): "2 lines skipped: null product_id and no product_resolve_key", "3 conditional lines skipped: no configuration provided", "1 line unresolved: resolve key 'fabric' missing from snapshot", etc.

#### 8. Readiness checklist integration

Expose `useIsBomReady(productId): boolean` — returns `true` when at least one BomHeader with at least one non-soft-deleted BomLine exists for the product. Foundation overview tab calls this to flip BOM ○ → ✓.

Also expose `useBomHeaderNamesByIds(bomHeaderIds: readonly string[]): ReadonlyMap<string, string>` — batch UUID → name resolution backed by React Query. The overview tab's production-method cards each link to a specific `BomHeader` via `pm.bomHeaderId`, and the cards use this hook to render the name of that specific BomHeader rather than a product-wide "primary" name (different PMs can link to different BomHeaders). Missing ids render a fallback label.

#### 9. Unit tests

Already completed as part of Phase B algorithm work (`lib/bom-explosion.ts` — 16 tests, validators — 12 tests, cycle detection — 6 tests, variant matching — 8 tests). No additional unit tests required for the UI layer.

#### 10. Integration tests

Tests in `packages/manufacturing/src/modules/bom/__integration__/bom-tab.spec.ts`. Playwright, API-first setup + UI navigation.

| ID | Scenario | Validates |
|---|---|---|
| B-UI-1 | Open product detail with no BOM → verify BOM tab shows "No bill of materials defined" empty state → click "Create BOM" → create BomHeader → verify tree renders | Empty state, BomHeader create, Graceful Incompleteness |
| B-UI-2 | Add Static BomLine with null `product_id` → verify row saves successfully → verify "Product not selected" placeholder with warning icon on display | Graceful Incompleteness — save with incomplete data |
| B-UI-3 | Add 3 BOM lines → reorder via up/down buttons → verify `sort_order` updated and display order reflects change | Reorder without drag-and-drop |
| B-UI-4 | Open BomLine edit dialog → set variant_condition with an unknown key (not in ConfigAttributes) → verify warning badge on row after save → save succeeds | Namespace validation warning (non-blocking) |
| B-UI-5 | Product with `configuration_type='none'`, no variant conditions → click "Explode BOM" → verify explosion panel shows only button + date picker → result shows all lines | Adaptive explosion panel — simplest case |
| B-UI-6 | Product with `configuration_type='rule_based'`, 3 ConfigAttributes (from sub-spec d) → explode → verify `ConfigurationForm` renders → fill + resolve + explode → correct lines filtered | Adaptive explosion panel — rule_based case, integration with sub-spec d UI |
| B-UI-7 | Add BomLineVariant override on existing BomLine → expand arrow → verify override row renders → edit quantity override → verify persisted | BomLineVariant inline CRUD |
| B-UI-8 | Create child BomHeader with `is_phantom=true`, reference from parent BomLine → explode parent → verify phantom children merged flat into result | Phantom pass-through in explosion result |
| B-UI-9 | Product with `configuration_type='variant_based'`, BomLineVariants exist → open explosion panel → verify variant picker (CatalogProductVariant select) + effective date → select variant → explode → correct overrides applied | Adaptive explosion panel — variant_based case |
| B-UI-10 | Product with `configuration_type='rule_based'`, no ConfigAttributes defined → open explosion panel → verify just button + date + "No configuration attributes defined" message → explode → result includes only unconditional lines, conditional lines skipped with warning | Adaptive explosion panel — rule_based with no attributes |
| B-UI-11 | Product with BomLines having variant_conditions but `configuration_type='none'` → open explosion panel → verify warning "N lines have variant conditions but no configuration provided" → explode → conditional lines skipped | Adaptive explosion panel — orphaned conditions |
| B-UI-12 | Add Static BomLine with `product_id` set and `product_variant_id` pinned to a specific ProductVariant → explode → verify the output line carries the pinned `productId` + `productVariantId` → issue where-used query with `productVariantId` → verify the BomLine is found | Static-mode variant pinning; where-used covers `product_variant_id` |
| B-UI-13 | Add Dynamic BomLine with `product_resolve_key` matching a `product_variant`-typed ConfigAttribute → submit `variantConditions` carrying the ProductVariant UUID for that key → explode → verify the output line's `productId` + `productVariantId` match the resolved variant's IDs, no matching warning in the result | Dynamic resolution — `product_variant` type-directed branch |
| B-UI-14 | Add Dynamic BomLine with `product_resolve_key` matching a `product`-typed ConfigAttribute (no ProductVariants) → submit `variantConditions` carrying the Product UUID for that key → explode → verify `productId` matches the resolved Product, `productVariantId` is null, no matching warning | Dynamic resolution — `product` type-directed branch |
| B-UI-15 | Add Dynamic BomLine → explode with `variantConditions` that omits the resolve key → verify explosion completes (partial), `warnings[]` lists the missing key for this bomLineId, the output line's `productId` is null, and the UI renders the row with muted style + "Not in planning" badge | Soft-error semantics — graceful partial explosion |
| B-UI-16 | Add Dynamic BomLine + matching BomLineVariant with both `product_override_id` and `product_variant_override_id` set → explode with `variantConditions` that deliberately fails Step 2 resolution for that key → verify the override wins (output `productId` + `productVariantId` match the override UUIDs) and that Step 2's queued warning is **not** present in the final result (it was discarded when the override filled the fields) | Override precedence + warning-suppression over dynamic resolve key |
| B-UI-17 | Attempt to save BomLine with both `product_id` and `product_resolve_key` set → verify validation error (XOR constraint) surfaced in the form | XOR enforcement at save time |
| B-UI-18 | Attempt to save Static BomLine with `product_variant_id` pinned to a variant of a different Product → verify validation error (`product_variant.product_id === product_id` drift guard) | Static-mode drift guard |
| B-UI-19 | Attempt to save BomLineVariant with `product_variant_override_id` set but `product_override_id` null → verify validation error (set-together constraint) | BomLineVariant pair constraint |
| B-UI-20 | Attempt to save BomLineVariant with `product_override_id` + `product_variant_override_id` where the ProductVariant belongs to a different Product → verify validation error (drift guard) | `product_variant_override.product_id === product_override.id` check |
| B-UI-21 | Open BomLine dialog on a rule-based master with enum + product_variant ConfigAttributes → `VariantConditionEditor` shows both keys in the key combobox → select the enum key, pick two allowed values → select the product_variant key, pick two variants via the catalog combobox → save → tree row renders `VariantConditionBadges` with the enum values as raw strings and the product_variant values hydrated to display names (not UUIDs) | Shared VariantCondition UX — typed authoring round-trip + UUID hydration |
| B-UI-22 | Open BomLine dialog on a semi-product whose own ConfigAttributes is empty → key combobox is empty → type a free-text key (e.g., `fabric`) → pick values via the text fallback renderer → save → tree row renders `VariantConditionBadges` with the free-text key styled as "Unknown key" (tooltip references consuming-master runtime match) → editing the row reopens the editor with the same free-text key pre-selected | Shared VariantCondition UX — semi-product authoring with free-text keys (Graceful Incompleteness + no raw JSON) |

**Testable outcome:** BOM tab visible in product detail. Add/edit lines with validated variant conditions and UoM selection. Expand variant overrides. Run explosion in all 5 adaptive panel states and see results. Overview tab reflects BOM readiness. All unit and integration tests pass. No raw JSON surface for `variant_condition` anywhere in the UI.

#### 11. Future optimizations (deferred)

Known performance opportunities that were intentionally not addressed in the initial tree-view / inline-section work. Each entry records the problem, a suggested direction, and a trigger condition for when it becomes worth doing. Do not pre-optimize — pick these up only when the trigger fires.

**Batched BomLineVariants fetching.**
- *Problem*: `useBomLineVariants` fires one `GET /api/bom/bom-line-variant?bomLineId=<id>` per rendered BomLine, eagerly, to populate the `[N] ▶/▼` count badge in the Variants column. A 37-line BOM produces 37 parallel requests; the per-request overhead (auth, DB round-trip) dominates even though each payload is small.
- *Suggested direction*: add a plural `bomLineIds` filter (comma-separated UUIDs, same shape as the existing `ids` catch-all) to `/api/bom/bom-line-variant`'s `listSchema`; alternatively expose a dedicated `GET /api/bom/bom-header/<id>/variants` that returns every variant under the header scoped by its lines. The hook then fires a single request per BomHeader instead of per line.
- *Trigger*: visible paint-time latency on real-world BOMs (50+ visible lines, or noticeably slower on dev-container / remote databases); or network-panel noise that distracts during debugging.

**Catalog-lookup context-based aggregation.**
- *Problem*: each `VariantConditionBadges` instance calls `useCatalogLookup` with only the UUIDs from its own row's condition. React Query dedupes by exact sorted-UUID signature, so different per-row UUID subsets produce different cache keys and therefore different `GET /api/catalog/products?ids=...` fetches. A BOM with many heterogeneous rows can issue 5–10 separate catalog fetches where one with the union would suffice.
- *Suggested direction*: introduce a `<CatalogLookupScope>` provider wrapped around BomTab (and any other page that renders multiple Badges). Each Badges instance registers its UUIDs on mount; the provider aggregates into a union, fires a single `useCatalogLookup`, and exposes the resolved maps via context. Badges read from context when present, fall back to the self-contained hook when standalone (keeps the component usable outside a BomTab). See §Risks entry below for the implementation hazards (render loops, cleanup on collapse, re-fetch on expand).
- *Trigger*: noticeable paint-time latency on large BOMs, or when backend team flags `/api/catalog/products` hit rate from the BOM tab.

**Open risks for both optimizations.** The context-based aggregation in particular introduces render-loop / unmount-cleanup hazards documented in the 2026-04-19 discussion — mitigable but non-trivial. A dedicated review pass is expected when either is picked up.

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
- **Scenario**: BOM exists with lines that have null `product_id` (and no `product_resolve_key`), null quantities, or no lines at all. User requests explosion
- **Severity**: Low
- **Affected area**: Explosion result
- **Mitigation**: Per Graceful Incompleteness principle. Explosion skips lines where both `product_id` and `product_resolve_key` are null (adds warning to result). Lines with null quantity treated as 0. Empty BOM returns empty result with warning "BOM has no active lines." No error thrown — partial results are valid
- **Residual risk**: None — this is the intended design

#### Unresolved Dynamic Resolve Keys
- **Scenario**: BOM line has `product_resolve_key` set but `variantConditions` supplied to explosion either omits the key, or the UUID does not exist in the catalog table implied by the ConfigAttribute's `attribute_type`, or the ConfigAttribute itself has been deleted since the BOM was saved
- **Severity**: Low
- **Affected area**: Explosion result, downstream planning (MRP, purchasing, work orders)
- **Mitigation**: Soft-error design. Step 2 leaves the output line's `productId` null, queues a per-line warning, and continues the explosion. If Step 3 override does not fix the line, the warning flushes into `result.warnings[]` (keyed by `bomLineId`). Unresolved lines are visible in the UI with a muted style and excluded from planning totals. Namespace validation at BomLine save time (warning against the current set of `ConfigAttribute.key` values) catches most drift early
- **Residual risk**: A user can still submit variantConditions missing keys or containing dangling UUIDs. This is intentional — the system surfaces gaps at explosion time rather than blocking upstream flows. Consumers documented to filter `productId === null` out of planning totals

#### Where-Used Does Not Cover Resolve-Key Lines
- **Scenario**: A user wants to delete a CatalogProduct (or CatalogProductVariant) that is only reachable from a BomLine dynamically — there is no static FK on any BomLine pointing to it, but some ConfigAttribute has a `product_filter_id` category containing it, so a future explosion could select its UUID in `variantConditions[key]` and resolve a `product_resolve_key` line to it. The where-used query matches only static FKs on the master (`product_id` / `product_variant_id`) and on BomLineVariant overrides, so it returns no hits and suggests the product is safe to delete
- **Severity**: Low
- **Affected area**: Impact analysis, catalog lifecycle
- **Mitigation**: `product_resolve_key` references `ConfigAttribute.key`, not a specific Product — the dynamic Product relationship emerges only at runtime when a snapshot carrying that UUID is supplied to explosion. Out-of-scope for Phase 1 where-used. When catalog lifecycle management lands (ECM module, future phase), add a snapshot-aware resolve-key traversal that, given a candidate Product / ProductVariant UUID, enumerates the `ConfigAttribute` rows whose `product_filter_id` category contains it and then the BomLines whose `product_resolve_key` matches those attribute keys
- **Residual risk**: A deleted Product / ProductVariant that was only reachable via a resolve-key path will surface as an unresolved line at the next explosion — `productId === null` + a per-line warning in `result.warnings[]` (ID not found in the expected catalog table) — same soft-error path as any other missing resolution. No silent data loss

#### Recursive Tree View — Cycle + Performance Guards
- **Scenario**: The §4 tree view drills into nested `semi_product` BomHeaders on expand. A corrupt row (sidestepping save-time cycle detection) or a very deep BOM (4+ levels) could cause infinite recursion or an N×M cold-start waterfall of child-header fetches
- **Severity**: Low
- **Affected area**: BOM tab responsiveness
- **Mitigation**: Two guards. (a) Cycle guard — maintain an ancestor-chain `Set<bomHeaderId>` during tree flatten; a child whose id is already in the chain renders a muted arrow + "Cycle detected" tooltip and skips the expansion. (b) Lazy loading — children load on expand click only (not on mount); React Query caches by `bomHeaderId` so re-collapse/re-expand is free. Deep BOMs therefore load one header's lines per user interaction, not upfront
- **Residual risk**: A user manually expanding every level of a 20-level BOM triggers 20 sequential fetches; acceptable — this is an authoring edge case, planning still goes through the explosion panel (§7) which preloads the full graph server-side

#### Semi-Product Authoring Key Scope
- **Scenario**: A user opens the BOM tab on a semi-product (e.g., "leg-kit sub-assembly") and edits a `variant_condition` or a `product_resolve_key` on one of its BomLines. The semi-product typically has no ConfigAttributes of its own; the keys the user actually wants belong to the *consuming master's* namespace (the chair that will embed the leg-kit). From the semi-product's page, the consuming master is unknowable — a semi-product may be embedded in multiple masters with conflicting key sets
- **Severity**: Low
- **Affected area**: BOM tab UX on semi-products
- **Mitigation**: `VariantConditionEditor` tolerates free-text keys with a non-blocking "Unknown key" warning; the spec's §BomLine Constraints and §Variant Condition Matching sections make the runtime-matches-top-level-master rule explicit so users can reason about why free-text keys are legitimate. Unknown keys surface as warnings in the tree row, not errors. Runtime matching is unchanged — the top-level master's snapshot is the single source of truth at explosion time
- **Future work — master-perspective viewer**: add a "view as master X" picker on the semi-product detail page. Given a candidate master (one of the semi-product's consumers, enumerated via where-used), the page re-scopes every `useConfigAttributeKeys(productId)` call on that page to use the master's ConfigAttributes instead of the semi-product's. The editor's key combobox then offers the master's keys with per-type value renderers. Out of scope for Phase C; tracked here so we don't repeat the design discussion when it lands
- **Residual risk**: A user with no consuming-master context could type a key the consuming master doesn't have and never hear about it until an explosion shows the line as unmatched/skipped. Acceptable — same Graceful Incompleteness trade-off used elsewhere in the spec; the user sees the Unknown key warning while authoring

## Final Compliance Report — 2026-04-04

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/queue/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | ORM relations only within bom module (BomHeader↔BomLine↔BomLineVariant). Cross-module refs (`product_id`, `product_variant_id`, `operation_template_id`, `product_override_id`, `product_variant_override_id`) use UUID strings. PM→BOM link owned by ProductionMethod, not BomHeader |
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

## Final Compliance Report — 2026-04-17 (amendment: dynamic product resolution)

Incremental review covering the 2026-04-17 changes (BomLine schema, BomLineVariant pair override, explosion Step 2, UI dialogs, tests). All prior compliance findings remain valid.

### AGENTS.md Files Reviewed (delta)
- `AGENTS.md` (root) — Contract Surfaces §8 (DB schema additive-only), §7 (API route stability), §2 (type definitions)
- `packages/core/AGENTS.md` — Command pattern, ACL, events
- `packages/shared/AGENTS.md` — Zod validators, cross-module references
- `packages/queue/AGENTS.md` — unchanged (no new worker)

### Compliance Matrix (delta)

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md §8 | DB schema additive-only (contract surface) | Compliant — pre-release exception | `packages/manufacturing` is pre-release (not shipped). Renames `material_id → product_id`, `material_override_id → product_override_id` applied via BC option A (clean rename) agreed in the 2026-04-17 sync. Migration is hand-written per the external-package playbook |
| root AGENTS.md §2 | Type definitions STABLE — required fields cannot be removed | Compliant — pre-release exception | Same pre-release justification. `ExplosionInput` keeps a single `variantConditions` input (no separate snapshot field added). `ExplosionLine.productId` replaces `materialId`; `productVariantId` added. No `resolutionStatus` field — derivable from `productId === null` + master's `product_resolve_key`, reducing type surface |
| root AGENTS.md §7 | API route response fields additive-only | Compliant — pre-release exception | `ExplosionLine` on the explode response changes `materialId` → `productId` + adds `productVariantId`. Where-used query param renamed `materialId` → `productId` |
| root AGENTS.md | Singular naming for entities/commands/events | Compliant | `product_id`, `product_variant_id`, `product_resolve_key`, `product_override_id`, `product_variant_override_id` — all singular |
| root AGENTS.md | FK IDs for cross-module links | Compliant | All new columns are UUID FKs, no ORM relations across modules |
| root AGENTS.md | Validate inputs with Zod | Compliant | New constraints: XOR (resolve_key vs product_id / product_variant_id), variant-requires-product, line_type scope, variant-belongs-to-product drift guards |
| root AGENTS.md | Tenant isolation (`organization_id`) | Compliant | BomLine / BomLineVariant inherit tenant scoping; new indexes tenant-scoped |
| root AGENTS.md | Write operations via Command pattern | Compliant | No new commands required — `bom.bom_line.*` commands handle all mutations including the new columns. Dynamic resolution at explosion time is a runtime transformation, not a persisted mutation |
| root AGENTS.md | Undo/rollback for mutations | Compliant | BomLine / BomLineVariant command undo already restores previous field values; new columns participate automatically |
| root AGENTS.md | Event IDs: module.entity.action (singular) | Compliant | No new event IDs; explosion `warnings[]` array carries unresolved-line information per 2026-04-17 decision |
| root AGENTS.md | DB CHECK constraints expressed | Compliant — app-level | Intentionally **no new DB CHECKs** added in this amendment. All new invariants are enforced in Zod at the app layer (`data/validators.ts`), with soft-error fallback at explosion time (line emitted with `productId === null` + warning in `result.warnings[]`). Rationale: the Graceful Incompleteness philosophy prefers actionable warnings over opaque Postgres errors; migration complexity is lower; the pre-existing BomLineVariant activation XOR CHECK is preserved unchanged |
| root AGENTS.md | `pageSize <= 100` | N/A — where-used endpoint inherits existing paging |
| packages/core/AGENTS.md | API routes MUST export openApi | Compliant | Existing routes updated in-place; where-used param rename and explode request extension flow through the existing `openApi` export |

### Internal Consistency Check (delta)

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | BomLine + BomLineVariant columns match explode request (single `variantConditions` input consumed by Steps 1 / 2 / 3) and where-used query params |
| API contracts match UI/UX section | Pass | Static/Dynamic mode toggle, ProductVariant pickers, explosion result `Resolution` column all consume the updated shapes |
| Risks cover all write operations | Pass | Two new risks added: Unresolved Dynamic Resolve Keys, Where-Used Does Not Cover Resolve-Key Lines |
| Commands defined for all mutations | Pass | Existing 9 commands cover all CRUD including new columns; no new mutation paths |
| Tests cover new branches | Pass | B-UI-12..20 cover static variant pinning (+ where-used), both type-directed resolution branches (`product` and `product_variant`), unresolved partial explosion, override precedence with warning suppression, and all four new constraint checks (XOR save-time, Static-mode variant-product drift, BomLineVariant set-together, BomLineVariant variant-product drift) |

### Migration & Backward Compatibility (option A — pre-release rename)

Packages/manufacturing is not shipped to third parties. BC contract applies to released platform surfaces; pre-release renames within a feature branch before publication are in scope. The hand-written migration must:
1. Rename `bom_line.material_id` → `bom_line.product_id`.
2. Add `bom_line.product_variant_id` (nullable UUID), `bom_line.product_resolve_key` (nullable VARCHAR(100)).
3. Rename `bom_line_variant.material_override_id` → `bom_line_variant.product_override_id`.
4. Add `bom_line_variant.product_variant_override_id` (nullable UUID).
5. No new DB CHECK constraints — the new invariants are enforced at the app layer (Zod). The pre-existing BomLineVariant activation-XOR CHECK is kept as-is.
6. Drop the old `(organization_id, material_id)` index; create `(organization_id, product_id)`, `(organization_id, product_variant_id)`, `(organization_id, product_resolve_key)` on `bom_line` and `(organization_id, product_override_id)`, `(organization_id, product_variant_override_id)` on `bom_line_variant`.

No column drops beyond the two renames. No data loss scenarios (existing `material_id` values become `product_id` values verbatim).

### Verdict

**Fully compliant** — amendment ready for implementation (code pass is a follow-up task). **Code pass complete 2026-04-18** — see Implementation Status and the 2026-04-18 Changelog entry below for details.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — Entities + CRUD | Done | 2026-04-04 | 3 entities, 9 commands, 3 CRUD routes, where-used endpoint, cycle detection, migration |
| Phase B — Explosion + Worker | Done | 2026-04-04 | Pure explosion algorithm, async queue worker with ProgressService, explode endpoint |
| Phase C — Widget + Tests | In Progress | 2026-04-04 | Algorithm + unit tests done (44 tests). BOM tab placeholder landed in foundation spec Phase 3. Detailed BomTab UI migrated into this spec (2026-04-11 refactor). Shared VariantCondition components (§3) folded into Phase C scope on 2026-04-18 so no raw-JSON `variant_condition` surface ever ships; also added B-UI-21/22 click-through tests — implementation not started |
| Review fixes | Done | 2026-04-06 | Removed production_method_id from BomHeader entity/validator/command/route. Added 3 bom_line_variant CRUD events. Migration regenerated |
| 2026-04-17 amendment — code pass | Done | 2026-04-18 | Full schema + runtime + test implementation of the 2026-04-17 amendment. Entities: BomLine rename + `product_variant_id` / `product_resolve_key`, BomLineVariant rename + `product_variant_override_id`, hand-written migration, org-scoped indexes. App-layer invariants: Zod `.superRefine()` on create schemas + post-merge check in update commands (XOR static-vs-dynamic, variant-requires-product, resolve-key scope, override pair); catalog drift guards at create/update (BomLine + BomLineVariant override). Explosion: `ExplosionContext` 3rd arg with flat data types, `ExplosionLine.productVariantId` field, `resolveFromResolveKey` Step 2 helper with type-directed `'product'` / `'product_variant'` branches + five failure warnings, `applyLineVariantOverrides` carries override pair onto output. `ExplosionInput.variantConditions: Record<string, string>` (scalar-in-array matcher); configurator's `resolvedConditions` flows straight in. `ExplosionResult.warnings: ExplosionWarning[]` (structured `{ bomLineId, message }`), material-line branch emits null-productId rows so UI can surface them (downstream consumers filter `productId === null`); `warningsByLineId(result)` helper. Worker pre-loads ConfigAttribute + CatalogProduct + CatalogProductVariant maps via BFS over the BOM graph. Where-used query rewritten for 4-way match (product_id, product_variant_id, BomLineVariant override pair); resolve-key lines not traversed. 253/253 unit tests + 10/10 Playwright integration tests (dynamic resolution E2E, static pinning, override pair, save-time invariants). **UI muted styling** for null-productId rows lands with the BOM tree view (Phase C, currently a placeholder) |

---

## Changelog

### 2026-04-19
- **BOM header selector simplified (§2 amendment).** Dropped the Auto/Manual mode toggle and mode label chrome in favor of a single combobox listing every BomHeader. First active header (sorted `created_at asc`) is selected by default; callers switch by picking from the dropdown. The selector is hidden entirely when the product has a single BomHeader (common case — no chrome needed). Snapshot-aware "pick the right BOM for this variant/config" lives in the explosion panel (§7), not here — the explosion panel calls `POST .../production-method/resolve` independently of whatever the selector currently shows. The runtime resolution flow is unchanged; this is a UI-only simplification.
- **Tree view made recursive + Variants column added (§4 amendment).** Phase C §4 row display gains a dedicated Expand column (left-most) and a Variants column (near-rightmost); §6 now describes the overrides UX hosted by the Variants column rather than a separate full-row expand arrow. Runtime behavior unchanged.
  - **Recursive drill-in.** `line_type='semi_product'` rows with a non-null `child_bom_header_id` render an expand arrow; clicking fetches the child header's lines and renders them inline with `depth + 1` indent. Cycle guard: maintain an ancestor-chain `Set<bomHeaderId>` during flatten; a duplicate skips the nest and shows a muted "Cycle detected" arrow. Reorder stays scoped to the row's parent BomHeader (a nested line moves within its own header's ordering, not across).
  - **Master-perspective scope for nested `VariantConditionBadges`.** Child rows pass the **top-level master's `productId`** to `VariantConditionBadges` (not the child header's owning product) — matches explosion-time matcher semantics (runtime namespace is the top-level master's per §Variant Condition Matching). This is the first concrete use of the master-perspective pattern previously flagged as future work in §Risks *Semi-Product Authoring Key Scope*.
  - **In-tree `[+ Add line]` pseudo-row.** After the last line of each rendered BomHeader (top-level and every expanded child), the tree renders a dashed muted pseudo-row that opens the §5 BomLine CRUD dialog scoped to that `bomHeaderId`. One uniform gesture adds lines at any depth; no separate toolbar button needed. Empty header → the pseudo-row becomes the only row, copy "+ Add first line". §5 entry points updated accordingly — the dialog's `lineType` select covers both material and sub-assembly cases.
  - **Variants column (§6 merge).** Right-most content column before actions. Always shows `+ Add`; when the line has ≥ 1 BomLineVariant, adds `[N]` count badge + ▶/▼ toggle. Toggle reveals the §6 overrides section as a full-width detail row (`<td colSpan>`) beneath the line. Previously the spec reserved a row-level expand arrow for this — moving it into a dedicated column makes the affordance discoverable (count + Add visible at a glance) and composes cleanly with the new left-side drill-in arrow.
  - **New risk — Recursive Tree View Cycle + Performance Guards.** Documents the cycle guard + React Query lazy-loading pattern and its acceptable residual (deep-BOM manual-expand waterfall, mitigated by the explosion panel's server-side preload for planning use cases).
- **BomLine CRUD dialog landed (§5 implementation).** Static-mode dialog with Product + optional ProductVariant (material) / Child BomHeader (semi_product) pickers, quantities + UoM, `VariantConditionEditor`, toggle-gated effective dates, operation linker, notes. In-place "Create BOM" mini-dialog for semi_product lines. New-tab + focus-refetch affordance for Product / ProductVariant / UoM. Dynamic-mode toggle + resolve-key picker explicitly deferred to a follow-up.
- **Deferred from the C3 code pass** (explicit, so the gaps are visible in spec state rather than living only in code TODOs):
  - **Operation linker scoped to the product's PM-linked routings.** Spec §5 specifies *"combobox of OperationTemplate names for the routing template(s) linked to this product"*; current implementation lists every tenant OperationTemplate (capped at 100 per server limits). Scoping requires the routing-tab UI (sub-spec c) and a server-side filter that already exists (`routingTemplateId`). At tenants with hundreds of operations the combobox UX degrades — still functional, just noisy. Tracked in `useOperationTemplatesForProduct.ts` TODO.
  - **Concurrent-create sort_order race.** The default-sortOrder helper in `commands/bom-line.ts` computes `max(existing) + 1` via a non-locked query; two concurrent creates for the same `bomHeaderId` can produce duplicate `sort_order` values. Cosmetic only (tree view falls back to `created_at` ordering within a tie) and acceptable for the single-user admin flows this serves today. Any automation path that drives batched/concurrent creates (future import workflow, explosion-triggered auto-populate) MUST add pessimistic locking on the parent `BomHeader` or a `UNIQUE (bom_header_id, sort_order)` constraint + retry before shipping.
  - **Integration tests for §10 B-UI-2 / B-UI-4 / B-UI-21 / B-UI-22.** Server-side invariants (B-UI-17/18/19/20) are covered by `save-time-invariants.spec.ts` from the 2026-04-17 amendment; the new UI click-through scenarios (save-with-null-product, unknown-key warning, enum + product_variant editor round-trip, semi-product free-text fallback) land with the rest of Phase C click-through testing — covered only by unit tests on the pure helpers today.

### 2026-04-18
- **Shared VariantCondition UX folded into Phase C.** Two explicit design clarifications + a new Phase C subsection so that `variant_condition` is never exposed as raw JSON in any user-facing surface.
  - **Authoring vs. runtime namespace (§BomLine Constraints + §Variant Condition Matching).** Made the two distinct scopes explicit: (a) *authoring* — the ConfigAttribute keys of the BomHeader's direct product, used to populate suggestions in the editor; (b) *runtime* — the top-level configured master's snapshot, which flows top-down through every child BomHeader unchanged (the algorithm Step 5 text already said this; the Constraints and Matching sections didn't). Implication for semi-product BOM tabs: `useConfigAttributeKeys(semiProductId)` is commonly empty, so the editor MUST tolerate free-text keys with a non-blocking "Unknown key" warning (the consuming master is unknowable from a semi-product's page). No runtime change — the algorithm already matches against the top-level snapshot.
  - **New Phase C §3 — Shared VariantCondition components.** `VariantConditionBadges` (display) + `VariantConditionEditor` (authoring) + `useCatalogLookup` hook for UUID → name resolution on product / product_variant values. Row-per-key builder with per-type value renderers (enum multi-select, boolean checkboxes, numeric_range multi-select, text tags, product / product_variant multi-select combobox, unknown-key text fallback). Call sites: tree-view row (§4), BomLine CRUD dialog (§5), BomLineVariant inline override dialog (§6). Phase C subsections renumbered §3..§9 → §4..§10.
  - **New integration tests B-UI-21 / B-UI-22.** Round-trip typed authoring + UUID hydration on a rule-based master (B-UI-21); semi-product free-text key authoring with "Unknown key" styling (B-UI-22). Both are click-through tests deferred with the rest of Phase C UI click-through.
  - **New risk — Semi-Product Authoring Key Scope.** Documents the "consuming master unknowable from semi-product page" trade-off and tracks a future "view as master X" perspective picker as documented future work.
- **2026-04-17 amendment — code pass complete.** Implementation of all schema, app-layer invariant, explosion-algorithm, output-contract, and integration-test changes called for by the 2026-04-17 amendment.
  - **Entities + migration.** BomLine: `material_id` → `product_id`, added `product_variant_id` + `product_resolve_key` with indexes `manufacturing_bl_org_product_idx`, `_product_variant_idx`, `_product_resolve_key_idx` (old `_org_material_idx` dropped). BomLineVariant: `material_override_id` → `product_override_id`, added `product_variant_override_id` with two new org-scoped indexes. Activation-XOR DB CHECK preserved. Migration hand-written per the external-package playbook; DB wipe + reapply via `psql DROP CASCADE` + `yarn db:migrate` (greenfield regenerates migrations and clobbers hand-written ones; do not use it for manufacturing).
  - **App-layer invariants + drift guards.** Pure invariant functions `collectBomLineInvariantViolations(state)` + `collectBomLineVariantInvariantViolations(state)` in `data/validators.ts`. Create schemas wire them via `.superRefine()`; update commands call them on the merged post-patch state before mutation and throw `CrudHttpError(400)` on violations. Catalog drift guards (BomLine variant-belongs-to-product + BomLineVariant override variant-belongs-to-override-product) run at create and update, scoped by tenantId/organizationId/deletedAt to prevent cross-tenant leakage. `product_resolve_key` namespace probe deferred to UI-side pre-save via `POST /api/manufacturing/configurator/validate-namespace` (warning-only per Graceful Incompleteness; TODO comment in `commands/bom-line.ts`).
  - **ExplosionInput shape + Step 1 matcher.** `ExplosionInput.variantConditions: Record<string, string[]>` → `Record<string, string>`. Shared `matchVariantCondition` flipped to scalar-in-array inclusion (and scalar-not-in-array for the `{not:[…]}` branch). Filter arrays on `BomLine.variant_condition` / `OperationTemplateVariant.variant_condition` keep their array shape — they meaningfully express "active for any of these values"; user selections do not. All callers updated (bom-explode worker + route, routing time-rollup, product_master resolve-production-method). Configurator's `resolvedConditions` now flows straight in.
  - **Explosion Step 2 (type-directed dynamic product resolution).** `ExplosionContext` type added (flat data shapes — no ORM imports in the pure function). `explodeBom(input, loader, context)` signature; `ExplosionLine.productVariantId` field added. `resolveFromResolveKey` helper branches on `configAttributesByKey[key].attributeType`: `'product'` → `catalogProducts.get(uuid)`, `'product_variant'` → `catalogProductVariants.get(uuid)` (with `productId` taken from `variant.productId`). Five failure modes return `(null, null)` + a targeted warning: unknown resolve key; resolve key missing from `variantConditions`; wrong `attribute_type`; product UUID not in catalog; product variant UUID not in catalog. Two defense-in-depth guards: resolve-key on non-material line; both product_id and resolve-key set simultaneously. `applyLineVariantOverrides` takes a `starting` pair (Step 2 output flows in) and carries `productOverrideId` + `productVariantOverrideId` onto the emitted row; malformed "variant-without-product" override surfaces a warning. Step 2 warnings are discarded if Step 3 override fills in `productId`.
  - **Worker pre-load.** `workers/bom-explode.ts` runs `buildExplosionContext` before the pure function — BFS over the BOM graph (visited set prevents cycles), collects every catalog UUID referenced by lines / override pairs / `variantConditions` values (partitioned by `attribute_type`), batch-loads `CatalogProduct` + `CatalogProductVariant` in two queries, and indexes the master product's `ConfigAttribute` rows by key.
  - **Soft-error output contract.** `ExplosionResult.warnings: ExplosionWarning[]` where `ExplosionWarning = { bomLineId: string | null, message: string }`. Graph-level warnings (max depth, cycle, header missing/inactive) carry `bomLineId: null`; line-specific warnings (Step 2 failures, Step 3 malformed override, child-BOM-not-found, null-productId emit) carry the owning line.id. Material-line branch emits rows with `productId: null` when unresolved (matching the semi-product branch) so UI can surface them — downstream planning consumers (MRP, WO, purchasing) MUST filter `productId === null` from demand totals. `warningsByLineId(result)` helper groups line-specific warnings by bomLineId for UI consumers. **UI muted styling** lands with the BOM tree view (Phase C, currently a placeholder); the backend contract is fully exercised by tests.
  - **Where-used query.** Param rename `materialId` → `productId`, added optional `productVariantId`. 4-way match covers BomLine.product_id, BomLine.product_variant_id, BomLineVariant.product_override_id, BomLineVariant.product_variant_override_id. Resolve-key lines intentionally not traversed (snapshot-aware variant deferred; documented in Risks).
  - **Tests.** 253/253 unit tests + 10/10 Playwright integration tests pass. Integration coverage spans: dynamic-resolution E2E (D-UI-8/B-UI-13, D-UI-9/B-UI-14, D-UI-10); save-time invariants + drift guards (B-UI-17/18/19/20, each asserting the specific error shape its layer produces — Zod `details[]` vs command `fieldErrors{}` — plus negative-control list-and-count confirming no orphan row); static pinning + override pair propagation (B-UI-12, B-UI-16 covering override precedence **and** Step 2 warning suppression on a dynamic line whose resolve-key is deliberately missing, plus the `productOverrideId`-only shape that resets `productVariantId` to null even when the static line had one pinned). Fixture infrastructure at `bom/__integration__/helpers/fixtures.ts` hosts BomHeader/BomLine/BomLineVariant fixtures + `explodeBomAndWait` poll helper + `queryWhereUsed` helper + runtime shape probe on explosion output.
  - **Deferred from this code pass.** The code pass intentionally does not cover: (a) **browser UI click-through tests** for D-UI-2/8/9/10 and the BOM-tab variants of B-UI-13/14/15/16 — the current Playwright suites exercise the same runtime contracts via the API layer (enqueue `/api/bom/bom/explode` + poll progress) rather than driving a real browser; the click-through variants land with the BOM tree view and Configurator form UI in Phase C (currently placeholders). (b) **B-UI-15 as a standalone integration test** — its runtime half (Step 2 failure → null-productId emit + per-line warning) is fully asserted by D-UI-10, so a separate fixture would only duplicate coverage; the UI half (muted row style + "Not in planning" badge) lands with the BOM tree view in Phase C. (c) **Snapshot-aware where-used traversal of resolve-key lines** — the 4-way match covers explicit product / variant pinning only; indexing resolve-key lines requires threading a `variantConditions` snapshot through the query (tracked in §Risks *Where-Used Does Not Cover Resolve-Key Lines*).

### 2026-04-17
- **Dynamic product resolution on BomLine.** Renamed `material_id` → `product_id` (nullable). Added `product_variant_id` (nullable FK to CatalogProductVariant — static-writable at design time when the chosen Product has variants; for dynamic lines, Step 2 writes it into the explosion output, never into this persisted column). Added `product_resolve_key` (nullable VARCHAR(100), matches `ConfigAttribute.key`). XOR: when `product_resolve_key` is set, both FK columns must be null at design time. `semi_product` lines cannot use resolve keys.
- **BomLineVariant pair override.** Renamed `material_override_id` → `product_override_id`. Added `product_variant_override_id`. Either both null or `product_override_id` set with `product_variant_override_id` null or both set; application check enforces `product_variant_override.product_id === product_override_id` to prevent drift.
- **BOM explosion algorithm restructured and expanded.** Old Step 1 ("Configuration resolution — stub") folded into the `Input` preamble; there is no longer a numbered step for variant-condition resolution (that responsibility lives in sub-spec d, upstream of explosion). Steps renumbered as 1: Filter BomLines, 2: Resolve dynamic products, 3: Apply BomLineVariant overrides, 4: Phantom pass-through, 5: Recurse. New Step 2 defines a **type-directed** resolution: the explosion worker loads `ConfigAttribute` records for the master product once and uses `attribute_type` to choose the catalog table — `'product'` → `CatalogProduct.findById(uuid)`, `'product_variant'` → `CatalogProductVariant.findById(uuid)`. The UUID comes from `variantConditions[key]`; a separate `configurationSnapshot` input was considered and rejected as redundant with `variantConditions`. On any Step 2 failure (missing key, wrong attribute type, ID not found), the output line's `productId` stays null and a warning is **queued** on the line. Step 3 may still fill in `productId` via a BomLineVariant override; if it does, the queued warning is discarded. Remaining warnings flush into `result.warnings[]` after Step 3.
- **No `resolutionStatus` field, no "runtime copy" concept.** Earlier drafts of this amendment introduced both as ceremony; on review both were redundant with the existing pure-function output + warnings array. `resolutionStatus` was derivable from `productId === null` + the master's `product_resolve_key`; "runtime copy" was just a restatement of `ExplosionLine`. Dropped. Output is simpler: `ExplosionLine` gains only `productVariantId` (plus the `materialId` → `productId` rename).
- **ExplosionInput / ExplosionResult updated.** Kept `variantConditions` as the single input map and tightened its shape from `Record<string, string[]>` to `Record<string, string>` — the user's selection is always a single value per attribute, so the array wrapper was strictly redundant. Values now carry selected UUIDs (for `product` / `product_variant` attribute types) alongside the existing string values for other types. Step 1's matcher flipped from "array-in-array intersection" to "scalar-in-array inclusion" against `BomLine.variant_condition`'s filter arrays (whose array shape is preserved, since a filter really does say "active for SD01 OR SD02"). Renamed `materialId` → `productId` on `ExplosionLine`; added `productVariantId`. Lines with `productId === null` remain in the result for UI display but are excluded from planning.
- **Where-used query.** Param renamed `materialId` → `productId`, added optional `productVariantId`. Matches now cover static variant pinning and BomLineVariant override pair. Dynamic lines (resolve_key) are intentionally not traversed — documented in Risks; snapshot-aware resolve-key where-used deferred to a later phase.
- **UI dialogs.** BomLine Add/Edit dialog gains a **Static vs Dynamic** resolution-mode toggle, with mutually exclusive inputs (Static: Product + optional ProductVariant; Dynamic: resolve-key combobox of ConfigAttribute keys filtered to `product` / `product_variant` types). BomLineVariant override dialog renders Product + ProductVariant override pickers as a pair with the drift guard.
- **BOM tree + explosion result display.** Product column reflects pinned ProductVariant or resolve-key badge. Explosion result adds a `Resolution` column (`static` / `resolved (key)` / `unresolved (key)`) and greyed styling for unresolved rows.
- **Integration tests.** Kept B-UI-1..11 (with B-UI-2 updated to Static mode wording). Added B-UI-12..20: static variant pinning + where-used, type-directed `product_variant` branch, type-directed `product` branch, unresolved partial explosion, override precedence, XOR save-time check, static-mode drift guard, BomLineVariant set-together check, BomLineVariant drift guard.
- **Risks.** Updated *Incomplete BOM Data* wording. Added *Unresolved Dynamic Resolve Keys* and *Where-Used Does Not Cover Resolve-Key Lines*.
- **Migration.** Hand-written per external-package playbook: rename 2 columns (`bom_line.material_id` → `product_id`, `bom_line_variant.material_override_id` → `product_override_id`), add 3 columns on BomLine (`product_variant_id`, `product_resolve_key`) and 1 on BomLineVariant (`product_variant_override_id`), rebuild indexes for the new columns. **No new DB CHECK constraints** — invariants are app-enforced (Zod) to preserve the soft-error / Graceful Incompleteness flow. Pre-existing BomLineVariant activation-XOR CHECK unchanged. Pre-release BC exception justified in the 2026-04-17 amendment compliance report.
- **Removed `Market Reference` blockquote** from §Overview (phantom / variant mechanism / date-effective attributions against 13 reference systems). Comparative-research framing not consistent with OM's spec style.

### Review — 2026-04-17
- **Reviewer**: Agent (spec-writing skill)
- **Security**: Passed — no new auth surfaces; all mutations remain ACL-guarded via existing `bom.*` features; no PII introduced
- **Performance**: Passed — new indexes support the new query patterns (static variant where-used, resolve-key diagnostics). Step 2 adds one lookup per resolve-key line per explosion level; explosion remains async
- **Cache**: N/A — module has no cache layer (explosion is async, CRUD standard)
- **Commands**: Passed — no new commands; existing `bom.bom_line.*` and `bom.bom_line_variant.*` cover the new columns with undo
- **Risks**: Passed — two new risks with mitigations and residual risk documented
- **Verdict**: Approved — pending code pass (tracked separately)

### 2026-04-11
- **Phase C expansion**: Migrated detailed BOM tab UI spec from `2026-04-05-manufacturing-ui-foundation.md` (foundation UI spec refactor). Added BomTab component contract, BOM header selector modes, tree view layout, line CRUD dialogs, BomLineVariant inline section, adaptive explosion panel (5 states), readiness hook exports (`useIsBomReady`, `useBomName`), and 8 integration tests (B-UI-1..8). Phase C status: Done (placeholder only) → In Progress. Declared dependencies on foundation Phase 3 + Phase 2 (UoM) + sub-spec d Phase C (`useConfigAttributeKeys`).

### 2026-04-06
- Review fixes: removed production_method_id from BomHeader (FK direction reversal — PM owns bom_header_id). Added bom_line_variant CRUD events. Status → In Progress

### 2026-04-04
- Pre-implementation analysis fixes: added Phase 0 (multi-module package registration prerequisite), API route prefix verification note, findWithDecryption + withAtomicFlush in CRUD/cycle detection, ProgressService DI verification note, where-used clarified as single-level, bom_usage changed from ENUM to VARCHAR for extensibility, hand-write migrations note
- Initial sub-spec. 3 entities (BomHeader, BomLine, BomLineVariant). BOM explosion algorithm (5-step, async, with phantom/date-effective/variant handling). 3-phase implementation plan. Follows patterns from sub-spec a (commands, events, ACL, Graceful Incompleteness)
