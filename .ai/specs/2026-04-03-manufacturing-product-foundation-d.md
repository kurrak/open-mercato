# Manufacturing Product Foundation — d: Product Configurator

| Field | Value |
|-------|-------|
| **Status** | In Progress |
| **Created** | 2026-04-04 |
| **Parent spec** | `2026-04-03-manufacturing-product-foundation.md` |
| **Mode** | External Extension (`packages/manufacturing`, module `configurator`) |
| **Depends on** | Sub-spec a (product_master), Sub-spec b (BOM — variant_condition on BomLine/BomLineVariant), Sub-spec c (routing — variant_condition on OperationTemplateVariant) |
| **Sub-specs** | This is sub-spec **d** of 4 (a: Product Master, b: BOM, c: Routing, d: Configurator) — final increment |

---

## TLDR

**Key Points:**
- Add a `configurator` module within `packages/manufacturing` for rule-based product configuration: define configuration axes (attributes), validate combinations (constraint rules), and resolve a customer's choices into variant conditions that drive BOM explosion and routing variant overrides
- 2 new entities: ConfigAttribute (configuration axes per product), ConstraintRule (if-then validation rules per product)
- Configuration resolution engine: pure function that replaces the stub from sub-spec b's BOM explosion algorithm — takes a configuration snapshot, evaluates constraints, outputs resolved variant conditions
- Namespace rule enforcement: ConfigAttribute.key is the single source of truth for variant_condition keys across BOM and routing modules

**Scope:**
- Module: `src/modules/configurator/` with full auto-discovery
- 2 entities with cross-package UUID FK to CatalogProduct
- CRUD APIs + configuration resolution endpoint
- Configuration resolution engine in `lib/config-resolution.ts` (pure, unit-testable)
- Namespace validation on BomLine/OperationTemplateVariant save (cross-module enforcement)
- Configurator tab widget for product detail page

**Concerns:**
- Only applies to `rule_based` products (`configuration_type = 'rule_based'` on ProductManufacturingExtension). For `variant_based` products, OM's CatalogProductVariant is used directly — no configurator needed
- PriceAdjustment (configuration-dependent pricing) deferred until sales integration — this sub-spec handles BOM/routing resolution only
- Constraint engine uses simple JSON list evaluation (~300 rule limit). Expression engine / solver is a future enhancement
- Namespace rule creates a cross-module coupling: configurator defines the names, BOM and routing consume them. Changes to attribute names require updating variant_conditions

---

## Overview

When a product has many possible configurations (500 fabrics × 8 seat types × 9 side styles = 36,000+ combinations), materializing each as a `CatalogProductVariant` is impractical. Instead, the product is marked `rule_based` and configured dynamically via attributes and constraint rules.

The configurator sits upstream of BOM and routing: it answers "what did the customer choose?" and translates those choices into variant condition keys that BOM explosion and routing variant overrides already understand.

**Two configuration paths in the manufacturing package:**

| Product Type | How Configured | Entities Used | BOM/Routing Integration |
|---|---|---|---|
| `variant_based` | Pre-materialized OM CatalogProductVariant (up to ~50 combinations) | None from this module | BomLineVariant.variant_id FK, OperationTemplateVariant.variant_id FK |
| `rule_based` | Dynamic via ConfigAttribute + ConstraintRule (unlimited combinations) | ConfigAttribute, ConstraintRule | BomLine.variant_condition, BomLineVariant.variant_condition, OperationTemplateVariant.variant_condition — keys match ConfigAttribute.key |

## Problem Statement

1. **OM's variant model doesn't scale to manufacturing complexity.** `CatalogProductVariant` with `optionValues` JSONB works for e-commerce (S/M/L × Red/Blue = 6 variants). Manufacturing has 36,000+ combinations — materializing each is impossible.

2. **No configuration-to-BOM resolution.** Even if configuration choices are captured, there's no engine to translate "customer chose fabric Soro, seat SD04, backrest OP62" into the variant condition keys that BOM explosion uses to select the right materials.

3. **No constraint validation.** Manufacturing has physical compatibility rules: "frame SK23 only works with leg H2.5", "seat SD01N doesn't fit side panel B3". Without validation, invalid configurations reach production.

4. **No single source of truth for variant axes.** BOM lines use `variant_condition` keys, routing operations use the same keys — but nothing defines what those keys are, what values are valid, or how they relate. ConfigAttribute provides that definition.

## Proposed Solution

Add a `configurator` module with ConfigAttribute and ConstraintRule entities, a resolution engine, and namespace rule enforcement.

### Design Decisions

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 1 | Configurator scope | **BOM/routing resolution only — no pricing** | PriceAdjustment deferred until sales integration. Configurator resolves which BOM lines and routing overrides apply. Pricing layer is meaningless without sales order lines to consume it |
| 2 | Constraint engine | **Simple JSON list evaluation** | Evaluate rules by iterating sorted by priority, checking condition_json matches against current selections. O(n) per evaluation, <100ms for ~300 rules. Sufficient for target scale. Expression engine / solver = future enhancement |
| 3 | Configuration snapshot format | **Flat JSONB: `{"attribute_key": "selected_value"}`** | Keys = ConfigAttribute.key. Values = selected option. Metadata fields prefixed with `_` (e.g., `_resolved_at`). Same format used everywhere: resolution input, BOM explosion input, storage on future SalesOrderLine/WorkOrder |
| 4 | Namespace rule enforcement | **Two-layer: warning at save, soft error at runtime** | Save-time warnings preserve Graceful Incompleteness (BOM may be drafted before the configurator is defined). Runtime failures during BOM explosion surface as `ExplosionLine.productId === null` + a per-line entry in `result.warnings[]`, not as exceptions, so partial explosion keeps working. Full mechanics in §Namespace Rule below |
| 5 | Dynamic product attribute types | **Two enum values: `'product'` and `'product_variant'`; UUID-valued snapshots** | `'product'` resolves a selected option to a CatalogProduct (no variants — e.g., options modelled as separate products). `'product_variant'` resolves to a CatalogProductVariant (e.g., colour/size variants of a collection product). Both use `product_filter_id` to scope the searchable combobox to a catalog category. The configuration snapshot stores the selected value as a UUID (CatalogProduct.id or CatalogProductVariant.id, per the attribute's `attribute_type`). Sub-spec b Step 2 does a **type-directed** lookup on that UUID — `'product'` → `CatalogProduct.findById`, `'product_variant'` → `CatalogProductVariant.findById` — with no fallback / no code-to-entity disambiguation. Follows Carbon ERP `configurationParameter` pattern, simplified by splitting the single `'material'` type and storing UUIDs instead of codes |

## Data Models

### ConfigAttribute

Defines one configuration axis for a product (e.g., "fabric", "seat type", "leg style").

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `product_id` | UUID | NOT NULL | — | FK to CatalogProduct (cross-package, UUID). The master product this attribute belongs to |
| `key` | VARCHAR(100) | NOT NULL | — | Technical identifier, snake_case. Used in variant_condition across BOM and routing. **Namespace rule: this key IS the variant_condition key.** UNIQUE per (organization_id, tenant_id, product_id). Should not be renamed after first use in variant_condition |
| `label` | VARCHAR(255) | NOT NULL | — | Human-readable display name (e.g., "Seat Type", "Fabric"). Translatable via translations.ts. Freely editable without breaking variant_conditions |
| `attribute_type` | VARCHAR(20) | NOT NULL | 'enum' | Type of attribute. Values: `'enum'` (select from list), `'numeric_range'` (slider/input), `'boolean'` (toggle), `'text'` (free text), `'product'` (live CatalogProduct lookup — option resolves to a Product), `'product_variant'` (live CatalogProductVariant lookup — option resolves to a ProductVariant). VARCHAR for extensibility |
| `allowed_values` | JSONB | nullable | null | For `enum`: `["SD01N","SD02N","SD03"]`. For `numeric_range`: `{"min":60,"max":260,"step":10}`. Null for `boolean`, `text`, `product`, `product_variant` |
| `product_filter_id` | UUID | nullable | null | FK to CatalogProduct category (cross-package, UUID). Only for `attribute_type = 'product'` or `'product_variant'` — scopes the searchable combobox to a catalog category so new products/variants in that category automatically appear in the configurator |
| `is_mandatory` | BOOLEAN | NOT NULL | true | Must the user select a value? Non-mandatory attributes can be left empty |
| `display_order` | INTEGER | NOT NULL | 0 | UI ordering of attributes within the configurator |
| `default_value` | VARCHAR(255) | nullable | null | Pre-selected value. Null = no default |
| `attribute_group` | VARCHAR(100) | nullable | null | UI grouping label (e.g., "Construction", "Fabric", "Finish"). Attributes in same group rendered together |
| `is_active` | BOOLEAN | NOT NULL | true | Soft toggle — inactive attributes excluded from configurator |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Indexes:** `(organization_id, tenant_id, product_id, key)` UNIQUE for namespace rule. `(organization_id, product_id, display_order)` for ordered attribute listing.

### ConstraintRule

If-then validation rule between configuration attributes. Evaluated after each user selection.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `product_id` | UUID | NOT NULL | — | FK to CatalogProduct (cross-package, UUID) |
| `condition_json` | JSONB | NOT NULL | — | Condition to check — same format as variant_condition: `{"attribute_key": ["value1","value2"]}` with AND semantics and negation support |
| `action_type` | VARCHAR(30) | NOT NULL | — | What happens when condition matches. Values: 'restrict_values' (limit options on target), 'exclude_combination' (block invalid combo), 'require_value' (force specific value), 'set_default' (suggest value, user can change) |
| `action_data` | JSONB | NOT NULL | — | Target of the action: `{"attribute_key": "forced_value"}` or `{"attribute_key": {"not": ["excluded"]}}` depending on action_type |
| `priority` | INTEGER | NOT NULL | 0 | Evaluation order — higher priority rules evaluated first. Rules at same priority: order by id (deterministic) |
| `description` | TEXT | nullable | null | Human-readable explanation (e.g., "Frame SK23 only fits with leg H2.5") |
| `is_active` | BOOLEAN | NOT NULL | true | Soft toggle |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Indexes:** `(organization_id, product_id, priority DESC)` for priority-ordered evaluation. `(organization_id, product_id, is_active)` for active rule filtering.

## Configuration Resolution Engine

Lives in `lib/config-resolution.ts` as a pure function. Called synchronously (rule evaluation is fast — <100ms for 300 rules).

### Input

```typescript
type ResolutionInput = {
  productId: string
  configSnapshot: Record<string, string>  // {"seat_type": "SD04", "fabric": "Soro_61", ...}
  attributes: ConfigAttribute[]           // loaded from DB for this product
  rules: ConstraintRule[]                 // loaded from DB, sorted by priority DESC
}
```

### Algorithm

1. **Validate snapshot keys** — warn (not reject) if snapshot contains keys not matching any ConfigAttribute.key. Warn if mandatory attributes are missing from snapshot. Graceful Incompleteness: partial snapshots are valid.

2. **Evaluate constraint rules** — iterate rules by priority (DESC):
   - Check `condition_json` against current snapshot values (same matching logic as BOM explosion's variant_condition matching)
   - If condition matches, apply action:
     - `restrict_values`: narrow `allowed_values` for target attribute — if current selection is now excluded, add to warnings
     - `exclude_combination`: if the forbidden combination exists in snapshot, add to errors
     - `require_value`: if target attribute has a different value, override it and add to warnings ("value changed by rule X")
     - `set_default`: if target attribute has no value, set it (user can change later)
   - Continue to next rule (rules can cascade — rule A's output affects rule B's condition)

3. **Build resolved variant conditions** — return the final snapshot in the same shape as BOM explosion's `variantConditions` input. The map has one selected value per key; no array wrapping. Example:
   ```typescript
   // Input snapshot:  {"seat_type": "SD04", "fabric": "<product-variant-uuid>", "backrest": "OP62"}
   // Output (resolvedConditions): same shape — {"seat_type": "SD04", "fabric": "<product-variant-uuid>", "backrest": "OP62"}
   ```
   When the input snapshot already contains UUIDs for `product` / `product_variant` attributes, constraint evaluation may rewrite or remove other keys but never wraps values in arrays. Consumers (BOM explosion Step 1, Step 2, Step 3; routing variant override matching) read scalar values and compare them against filter arrays on `BomLine.variant_condition` / `OperationTemplateVariant.variant_condition` (scalar-in-array inclusion).

### Output

```typescript
type ResolutionResult = {
  resolvedConditions: Record<string, string>    // feeds into BOM explosion + routing (same shape as ExplosionInput.variantConditions)
  resolvedSnapshot: Record<string, string>      // final snapshot after constraint evaluation (equivalent to resolvedConditions in this pass-through design; kept as a separate field for future divergence if constraint evaluation grows richer)
  errors: string[]                              // blocking: invalid combinations
  warnings: string[]                            // non-blocking: missing attributes, forced changes
  appliedRules: string[]                        // rule IDs that fired (for debugging)
}
```

### Integration with BOM Explosion

The resolution result replaces the stub from sub-spec b:

```
Before (sub-spec b):
  POST /api/manufacturing/bom/explode { bomHeaderId, variantConditions: {...} }
  ↑ caller must provide pre-resolved conditions

After (sub-spec d):
  POST /api/manufacturing/configurator/resolve { productId, configSnapshot: {...} }
  → returns resolvedConditions
  POST /api/manufacturing/bom/explode { bomHeaderId, variantConditions: resolvedConditions }
  ↑ or: a combined endpoint/workflow chains both steps
```

The BOM explosion API does not change — it still accepts `variantConditions`. The configurator provides the resolution layer that produces those conditions from a human-readable configuration snapshot.

## Namespace Rule

The namespace rule is the key architectural constraint connecting the configurator to BOM and routing:

**ConfigAttribute.key** is the single source of truth for variant_condition keys everywhere:

| Where variant_condition keys appear | Entity | Module |
|---|---|---|
| BOM line activation | BomLine.variant_condition | bom |
| BOM line variant override | BomLineVariant.variant_condition | bom |
| Routing operation variant override | OperationTemplateVariant.variant_condition | routing |
| Constraint rule conditions | ConstraintRule.condition_json | configurator |
| Constraint rule actions | ConstraintRule.action_data | configurator |
| Configuration snapshot | (JSONB on future SalesOrderLine, CPA, WorkOrder) | various |

**Enforcement — two layers:**

- **Save-time (design time)**: when saving a BomLine or OperationTemplateVariant with non-null `variant_condition`, or a BomLine with non-null `product_resolve_key`, validate that all referenced keys match an existing `ConfigAttribute.key` for the same master product. Unknown key = **warning, not block** — per Graceful Incompleteness, BOM/routing data may be drafted before configurator attributes are defined.
- **Runtime (explosion time)**: BOM explosion Step 2 performs a type-directed lookup for every BomLine with `product_resolve_key` set. The worker loads the master product's `ConfigAttribute` records once, reads the `attribute_type` for the resolve key (`'product'` or `'product_variant'`), and looks up the corresponding catalog table by the UUID carried in `variantConditions[key]`. When the key is missing from `variantConditions`, or the UUID does not match any row in the expected catalog table, or the ConfigAttribute's `attribute_type` cannot drive dynamic resolution (e.g., `'enum'`), the output `ExplosionLine` is emitted with `productId` null and a specific warning is appended to `result.warnings[]` keyed by `bomLineId`. Explosion continues (partial result); downstream consumers (MRP, work orders, purchasing) filter lines with `productId === null` out of planning totals but the UI surfaces them so the user can see what's missing.

## API Contracts

All routes under `/api/manufacturing/`. CRUD routes use `makeCrudRoute` with `openApi` export. All entity queries use `findWithDecryption`/`findOneWithDecryption` per OM convention.

**Route prefix convention:** Route files nested under `api/manufacturing/` (e.g., `api/manufacturing/config-attribute/route.ts` → `/api/manufacturing/config-attribute`). See sub-spec a for rationale.

### Config Attribute

- `GET /api/manufacturing/config-attribute` — List (filtered by product_id, attribute_type, attribute_group, is_active)
- `GET /api/manufacturing/config-attribute/:id` — Detail
- `POST /api/manufacturing/config-attribute` — Create
- `PUT /api/manufacturing/config-attribute/:id` — Update
- `DELETE /api/manufacturing/config-attribute/:id` — Soft delete

### Config Attribute Usage

- `GET /api/manufacturing/config-attribute/usage?id=<uuid>` — Count cross-module references to this attribute's key
  - Response: `{ bomLineCount: number, operationVariantCount: number }`
  - Queries BomLine (bom module) and OperationTemplateVariant (routing module) tables for rows where `variant_condition` JSON contains the attribute's `key`, scoped to the same `product_id` + `organization_id` + `tenant_id`. Cross-module query is allowed — same package (`packages/manufacturing`). Use `findWithDecryption` on both entities
  - ACL: requires `configurator.view`
  - Must export `openApi` (OM convention for all API routes)
  - Used by AttributesSection delete confirmation dialog to show impact warning

### Constraint Rule

- `GET /api/manufacturing/constraint-rule` — List (filtered by product_id, action_type, is_active, sorted by priority DESC)
- `GET /api/manufacturing/constraint-rule/:id` — Detail
- `POST /api/manufacturing/constraint-rule` — Create
- `PUT /api/manufacturing/constraint-rule/:id` — Update
- `DELETE /api/manufacturing/constraint-rule/:id` — Soft delete

### Configuration Resolution

- `POST /api/manufacturing/configurator/resolve` — Synchronous resolution
  - Request: `{ productId: string, configSnapshot: Record<string, string> }`
  - Response: `ResolutionResult` (resolvedConditions, errors, warnings, appliedRules)
  - Loads attributes + rules from DB, runs resolution engine, returns result
  - No write side effects — pure computation. Emits `configurator.configuration.resolved` event async (fire-and-forget after response) for analytics/logging only
  - ACL: requires `configurator.view` (read-only operation)

### Namespace Validation

- `POST /api/manufacturing/configurator/validate-namespace` — Validate variant_condition keys against ConfigAttribute names
  - Request: `{ productId: string, variantCondition: Record<string, unknown> }`
  - Response: `{ valid: boolean, unknownKeys: string[], warnings: string[] }`
  - Used by BOM and routing UIs when editing variant_condition fields. Also accepts BomLine `product_resolve_key` values for the same warning-only validation — callers pass the single key as `{ productId, variantCondition: { [resolveKey]: null } }` and the endpoint responds as if that key appeared on a variant_condition map

## Commands & Events

### Commands

| Command | Entity | Undo |
|---|---|---|
| `configurator.config_attribute.create` | ConfigAttribute | Delete created record |
| `configurator.config_attribute.update` | ConfigAttribute | Restore previous field values |
| `configurator.config_attribute.delete` | ConfigAttribute | Restore soft-deleted record |
| `configurator.constraint_rule.create` | ConstraintRule | Delete created record |
| `configurator.constraint_rule.update` | ConstraintRule | Restore previous field values |
| `configurator.constraint_rule.delete` | ConstraintRule | Restore soft-deleted record |

### Events

```typescript
const events = [
  { id: 'configurator.config_attribute.created', label: 'Config Attribute Created', entity: 'config_attribute', category: 'crud' },
  { id: 'configurator.config_attribute.updated', label: 'Config Attribute Updated', entity: 'config_attribute', category: 'crud' },
  { id: 'configurator.config_attribute.deleted', label: 'Config Attribute Deleted', entity: 'config_attribute', category: 'crud' },
  { id: 'configurator.constraint_rule.created', label: 'Constraint Rule Created', entity: 'constraint_rule', category: 'crud' },
  { id: 'configurator.constraint_rule.updated', label: 'Constraint Rule Updated', entity: 'constraint_rule', category: 'crud' },
  { id: 'configurator.constraint_rule.deleted', label: 'Constraint Rule Deleted', entity: 'constraint_rule', category: 'crud' },
  { id: 'configurator.configuration.resolved', label: 'Configuration Resolved', entity: 'config_attribute', category: 'lifecycle' },
] as const
```

Note: `configurator.configuration.resolved` is a lifecycle event (not CRUD) — emitted when resolution endpoint is called. Payload includes `productId`, `resolvedConditions`, `errorCount`, `warningCount`. Useful for analytics (which configs are most popular) and future AI agent integration.

## ACL Features

```typescript
export const features = [
  { id: 'configurator.view', title: 'View product configuration', module: 'configurator' },
  { id: 'configurator.edit', title: 'Edit configuration attributes and rules', module: 'configurator' },
]
```

Default role features:
```typescript
defaultRoleFeatures: {
  admin: ['configurator.*'],
  employee: ['configurator.view'],
}
```

## Implementation Plan

### Phase A: Entities + CRUD

1. Create `src/modules/configurator/` with: `index.ts`, `acl.ts`, `events.ts`, `setup.ts`, `di.ts`, `search.ts`, `translations.ts`
2. Create `data/entities.ts` with ConfigAttribute, ConstraintRule (no ORM relations between them — both FK to CatalogProduct by UUID)
3. Create `data/validators.ts` with Zod schemas. ConfigAttribute: validate attribute_type values, allowed_values shape per type, UNIQUE name per product. ConstraintRule: validate condition_json and action_data shapes per action_type
4. Create `translations.ts` declaring translatable fields: ConfigAttribute.label, ConfigAttribute.attribute_group, ConstraintRule.description. Zero runtime cost if no translations exist — ready for multi-locale when sales-facing configurator UI is needed
5. Create `search.ts` with searchConfig for ConfigAttribute (by name, product, attribute_group)
6. Hand-write migrations for config_attribute and constraint_rule tables. Follow migration playbook (known db:generate bug for external packages)
7. Create CRUD routes for config-attribute and constraint-rule under `api/manufacturing/`. All queries use `findWithDecryption`. All mutations use `validateCrudMutationGuard`
8. Update `packages/manufacturing/src/index.ts` to export configurator module

**Testable outcome:** Full CRUD on both entities. Attributes with UNIQUE name constraint per product enforced. Rules sorted by priority.

### Phase B: Resolution Engine + Namespace Validation

1. Create `lib/config-resolution.ts` — pure function, no DB dependency. Takes attributes + rules + snapshot, returns resolved conditions
2. Create `api/manufacturing/configurator/resolve.ts` — resolution endpoint. Loads data from DB, calls pure function, returns result. Emits `configurator.configuration.resolved` event
3. Create `api/manufacturing/configurator/validate-namespace.ts` — namespace validation endpoint
4. Create `lib/namespace-validator.ts` — pure function for key validation against attribute names
5. Integration point: BOM and routing UIs can call namespace validation when editing variant_condition fields (advisory, not blocking)

**Testable outcome:** Resolution endpoint accepts config snapshot, returns resolved conditions + errors + warnings. Namespace validation identifies unknown keys.

### Phase C: UI Widget + Tests

**Depends on:** `2026-04-05-manufacturing-ui-foundation.md` Phase 3 (tab shell, `ManufacturingTabsLayout`, detail page). Sub-spec b and c Phase C UIs depend on this phase for `variant_condition` namespace validation.

**Implement first among the tab UIs** — BOM and Routing tabs validate `variant_condition` keys against `ConfigAttribute.key` defined here.

#### 1. ConfiguratorTab component

- **Location**: `packages/manufacturing/src/modules/configurator/components/ConfiguratorTab.tsx` (exported and consumed by the product detail page from `2026-04-05-manufacturing-ui-foundation.md`)
- **Props**: `{ productId: string; configurationType?: string }` — decoupled from product_master types. The detail shell passes `configurationType={extension.configuration_type}` (one-line change in `product_master/backend/.../[id]/page.tsx`)
- **ACL**: none — thin shell delegates to `AttributesSection` which owns its own ACL check. Tab-level visibility is controlled by the detail shell (page metadata `requireFeatures`)

**Visibility & empty states** (owned by the detail shell via tab visibility rule, surfaced here as contract):
- `configurationType = 'rule_based'` → full tab body (renders `<AttributesSection>` + Test Configuration action)
- `configurationType = 'variant_based'` → tab body replaced with message: "This product uses variant-based configuration. Manage variants in the Catalog." with link to catalog product detail page
- `configurationType = 'none'` or undefined → tab hidden from tab bar (shell-side decision; component still safe to render)

`ConfiguratorTab` is a thin shell — it handles tab visibility logic and renders `AttributesSection` (§2). All attribute CRUD, empty states, and the Test Configuration dialog live inside `AttributesSection`.

#### 2. AttributesSection component

Self-contained component for ConfigAttribute CRUD. Extracted so it can be reused in two contexts:
1. **Now**: rendered by `ConfiguratorTab` on the manufacturing product detail page
2. **Future**: injectable as a `kind: 'group'` widget into the catalog product detail page (`crud-form:catalog.product`) — the widget wrapper would be a one-liner: `<AttributesSection productId={context.recordId} />`

- **Location**: `packages/manufacturing/src/modules/configurator/components/AttributesSection.tsx`
- **Props**: `{ productId: string }`
- **ACL feature**: `configurator.view` for reads, `configurator.edit` for writes
- **Empty state**: "No configuration attributes defined. Add attribute →" with primary button

DataTable of ConfigAttribute via `/api/manufacturing/config-attribute?product_id=<id>`:

| Column | Display |
|---|---|
| Key | Technical key (monospace) |
| Label | Display name (translatable) |
| Type | Badge: `enum` / `numeric_range` / `boolean` / `text` / `product` / `product_variant` |
| Values | Per type: `enum` → comma-separated preview of `allowed_values` (e.g., "SD01, SD02, SD03"); `numeric_range` → "min – max (step)" (e.g., "0 – 100 (5)"); `boolean` → "Yes / No"; `text` → "Free text"; `product` / `product_variant` → CatalogCategory name as link to `/backend/catalog/categories/[id]`, or "No category selected" if `product_filter_id` is null |
| Mandatory | Checkbox icon |
| Group | `attribute_group` label |
| (reorder) | Inline up/down arrow buttons (visible when `configurator.edit` granted) |

Row actions (stable ids): `edit`, `delete`

**Reorder column:** Inline `IconButton` arrows (up/down) in a dedicated narrow column. Calls `POST /api/manufacturing/config-attribute/reorder` with `{ sourceId, targetId }` for atomic swap. Replaces the previous approach of reorder actions in `RowActions` and a separate "Order" number column — arrow buttons provide clearer affordance.

**Delete confirmation:** Before deleting, call `GET /api/manufacturing/config-attribute/:id/usage` to get counts of referencing BomLines and OperationTemplateVariants. If either count > 0, the confirm dialog shows: "This attribute is referenced by N BOM lines and M routing overrides. Deleting it will orphan those references." Delete still proceeds if confirmed (Graceful Incompleteness — orphaned keys produce warning badges, not errors).

Header actions: "Add Attribute" (primary), **"Test Configuration"** (secondary/ghost, disabled when no attributes exist)

**Test Configuration dialog:**
- Opens a dialog with `ConfigurationForm` rendered from current attributes (`submitLabel="Resolve"`)
- User fills in attribute values → clicks "Resolve"
- Calls `POST /api/manufacturing/configurator/resolve` with the form snapshot
- Below the form, displays: resolved variant conditions as key→value table + warnings for missing mandatory attributes
- Read-only output — no side effects, no persistence
- Validates that the form renders correctly and shows what variant_condition values BOM explosion would match against

**Add/Edit dialog** — `CrudForm` with conditional fields per `attribute_type`:

- Common: `key` (snake_case validator, monospace input, **read-only after create** — cannot be edited once saved), `label` (translatable text), `attribute_type` (select — locked after create), `attribute_group`, `sort_order`, `is_mandatory`
- `enum` → list editor for `allowed_values` (add/remove rows)
- `numeric_range` → three inputs: min, max, step → serialized to `allowed_values: {min, max, step}`
- `boolean` → no additional fields (allowed values implicit)
- `text` → optional validation regex (deferred — no type-specific fields in initial implementation)
- `product` → combobox picking a CatalogCategory for `product_filter_id`
- `product_variant` → combobox picking a CatalogCategory for `product_filter_id` (same field, different resolution target at runtime)

**Reorder**: inline up/down `IconButton` arrows in a dedicated column, calls `POST /api/manufacturing/config-attribute/reorder` with `{ sourceId, targetId }` for atomic display_order swap.

#### 3. ConfigurationForm component

Dynamic form generated from active ConfigAttribute records — one field per attribute, grouped by `attribute_group`. Maps `attribute_type` to OM primitives:

| attribute_type | Input Component | Data Source |
|---|---|---|
| `enum` | Native `<select>` (matches CrudForm convention — no Select primitive exists) | `allowed_values` array |
| `numeric_range` | Number input with min/max/step | `allowed_values` `{min, max, step}` |
| `boolean` | Toggle | — |
| `text` | Text Input | — |
| `product` | `ComboboxInput` over CatalogProduct (from `@open-mercato/ui/backend/inputs/ComboboxInput`) | `/api/catalog/products?categoryIds=<product_filter_id>`. Selected value = `CatalogProduct.id` (UUID). Runtime Step 2 resolves the UUID to that CatalogProduct (no variant). **Fallback:** if API call fails or category is deleted/empty, show disabled combobox with "No products available — check category configuration" message. Never block the form — other attributes remain fillable |
| `product_variant` | **Two-step `ComboboxInput`** over (CatalogProduct → CatalogProductVariant). Step 1 picks the owning product; step 2 picks the variant within it. | **Step 1:** `/api/catalog/products?categoryIds=<product_filter_id>`. **Step 2:** `/api/catalog/variants?productId=<picked_product_id>`. Submitted snapshot value = `CatalogProductVariant.id` (UUID) — the step-1 product selection is UI-only scope and is NOT part of the snapshot. Runtime Step 2 resolves the UUID directly to that ProductVariant (the attribute_type on the ConfigAttribute makes the target table unambiguous — no dual-table fallback). **Fallbacks:** (a) category empty / products API fails → "No products available — check category configuration"; (b) step-1 product has no variants → "No variants on the selected product — pick a different product"; (c) pre-filled value from `default_value` triggers a one-shot `GET /api/catalog/variants?id=<uuid>&pageSize=1` to recover the owning product UUID so step-1 shows the correct pre-selection. Never blocks the form — other attributes remain fillable |

**Export path**: `packages/manufacturing/src/modules/configurator/components/ConfigurationForm.tsx`

**Props contract**:
```typescript
interface ConfigurationFormProps {
  productId: string;               // loads ConfigAttributes for this product
  onSubmit: (snapshot: Record<string, unknown>) => void;  // form values keyed by attribute key
  submitLabel?: string;            // button text (default: "Resolve")
  disabled?: boolean;              // disables all inputs + submit
}
```

The component is self-contained: it fetches `ConfigAttribute` records for the product, renders grouped inputs per `attribute_type` (see table above), and calls `onSubmit` with the completed snapshot. Form renders dynamically from loaded ConfigAttribute records, grouped by `attribute_group`. No hardcoded fields — form structure is entirely data-driven.

**Empty state:** When no ConfigAttributes exist for the product, renders a message "No configuration attributes defined" and disables the submit button. Consumers (BOM explosion, routing time rollup, Test Configuration dialog) should check `ready` state before rendering the form — but the component itself handles the empty case gracefully if rendered anyway.

**Consumers:**
- Sub-spec b BOM tab — explosion panel passes snapshot to the explode endpoint
- Sub-spec c Routing tab — time rollup panel passes snapshot for variant-aware calculation
- Test Configuration dialog (§2 header action) — calls resolve endpoint and displays result

#### 4. Namespace export for sub-specs b/c

Export a tiny hook `useConfigAttributeKeys(productId): { keys: string[]; ready: boolean }` from `packages/manufacturing/src/modules/configurator/components/useConfigAttributeKeys.ts`. BOM tab (sub-spec b) and Routing tab (sub-spec c) use this hook to validate `variant_condition` keys at edit time and display "unknown key" warnings. No API design required — uses the existing `/api/manufacturing/config-attribute?product_id=<id>` endpoint.

#### 5. Readiness checklist integration

Expose `useIsConfiguratorReady(productId): boolean` — returns `true` when `configuration_type === 'rule_based'` and at least one ConfigAttribute exists. The foundation overview tab calls this to flip configurator ○ → ✓.

#### 6. Constraint rules section — DEFERRED

> ConstraintRule entity and CRUD API exist (Phase A, implemented). UI for managing rules (list, condition/action editors) and rule evaluation in the resolution engine are deferred. Rules are a pre-processing layer on top of attribute values — BOM explosion and time rollup work without them (attribute values pass through as variant conditions directly). Will be added as a follow-up phase when the basic configurator UI is validated.

#### 7. Unit tests

Already completed as part of Phase C algorithm work (`lib/config-resolution.ts`, `lib/namespace-validator.ts` — 50 tests total). No additional unit tests required for the UI layer beyond the existing coverage.

#### 8. Integration tests

Tests in `packages/manufacturing/src/modules/configurator/__integration__/configurator-tab.spec.ts`. Playwright, API-first setup + UI navigation.

| ID | Scenario | Validates |
|---|---|---|
| D-UI-1 | Open product detail with `configuration_type='rule_based'` and no attributes → verify Configurator tab shows empty state → click "Add Attribute" → create enum attribute (key, label, values) → verify appears in table | Empty state, Attribute CRUD — enum |
| D-UI-2 | Create attribute of each type (`enum`, `numeric_range`, `boolean`, `text`, `product`, `product_variant`) → click "Test Configuration" → verify `ConfigurationForm` dialog renders one type-appropriate input per attribute, grouped by `attribute_group`. The `product` branch renders a single ComboboxInput over `/api/catalog/products?categoryIds=`; the `product_variant` branch renders **two stacked ComboboxInputs** — step 1 over `/api/catalog/products?categoryIds=` (UI-only scope), step 2 over `/api/catalog/variants?productId=` for the picked product | ConfigurationForm component — all 6 attribute_type branches |
| D-UI-3 | Create 3 attributes → click "Test Configuration" → fill values → click "Resolve" → verify resolved variant conditions table shows attribute key→value pairs → verify warning for unfilled mandatory attribute | Test Configuration dialog, resolve passthrough |
| D-UI-4 | Set `configuration_type='variant_based'` on the extension → open Configurator tab → verify message "This product uses variant-based configuration..." with catalog link instead of attribute UI | Conditional tab body |
| D-UI-5 | Set `configuration_type='none'` on the extension → verify Configurator tab not rendered in tab bar (shell decision) | Shell-side tab visibility contract |
| D-UI-6 | Create 3 attributes → reorder via up/down buttons → verify `sort_order` updated and display order reflects change | Reorder without drag-and-drop |
| D-UI-7 | Create attribute → create BomLine with `variant_condition` referencing that key (via BOM API) → click delete on the attribute → verify confirm dialog shows "referenced by 1 BOM line" → confirm → verify attribute soft-deleted → verify BomLine still renders with orphaned key warning badge | Delete impact warning via usage endpoint, Graceful Incompleteness. **Note:** depends on bom module Phase A (entities + CRUD, already done) — uses BOM API for fixture setup |
| D-UI-8 | Create attribute with `attribute_type = 'product_variant'` and a `product_filter_id` pointing to a populated catalog category whose products have variants → click "Test Configuration" → in step 1 pick a product; verify step 2 combobox populates with that product's variants → in step 2 pick a variant (combobox emits `CatalogProductVariant.id`) → click "Resolve" → verify resolved variant conditions table carries only the selected variant UUID for that key (no product UUID leaks into the snapshot) → invoke BOM explosion for a BomLine that uses this key as `product_resolve_key` → verify the output `ExplosionLine` carries the resolved Product + ProductVariant UUIDs and no matching warning appears in `result.warnings[]` | End-to-end type-directed resolution — configurator `product_variant` two-step picker → Step 2 ProductVariant branch. **Also covers** step-1 scope isolation (snapshot stores variant UUID only) |
| D-UI-9 | Create attribute with `attribute_type = 'product'` → select a Product option (combobox emits `CatalogProduct.id`) → resolve → explode a BomLine with that `product_resolve_key` → verify the output line carries `productId` of the resolved Product, `productVariantId` null, and no matching warning | End-to-end type-directed resolution — configurator `product` → Step 2 Product branch |
| D-UI-10 | Create attribute with `attribute_type = 'product_variant'` → click "Test Configuration" → **leave the attribute unfilled** → click "Resolve" → verify warning for missing mandatory attribute → explode a BomLine using that key as `product_resolve_key` → verify the output line's `productId` is null, `result.warnings[]` lists the missing key keyed by this `bomLineId`, and the UI renders the row in muted style | Runtime soft-error semantics — partial explosion via `productId === null` + targeted warning |

> **Deferred tests** (will be added when ConstraintRule UI lands): rule CRUD, `require_value` resolution, `exclude_combination` error display.

**Testable outcome:** Configurator tab visible in product detail for `rule_based` products. Attribute CRUD, Test Configuration dialog, and ConfigurationForm work. Other sub-spec UIs (b and c) can read the attribute key namespace via the exported hook and reuse ConfigurationForm.

## Risks & Impact Review

#### Constraint Rule Cascading Loops — DEFERRED
- Risk deferred along with ConstraintRule UI. The mitigation (max iteration limit) is already implemented in `lib/config-resolution.ts`. Will be relevant when rule UI lands

#### ConfigAttribute Key Rename Breaks variant_conditions — MITIGATED
- **Scenario**: User renames ConfigAttribute.key from "seat_type" to "seat_model". All BomLines and OperationTemplateVariants with `variant_condition: {"seat_type": [...]}` are now orphaned
- **Mitigation**: Key is **read-only after create** (Phase C §2). To change a key, user must delete the attribute (with impact warning via usage endpoint) and re-create with the new key. Delete confirmation shows affected BomLine/OperationTemplateVariant counts
- **Residual risk**: None — rename path eliminated by design

#### Product / ProductVariant Attribute Types Depend on Catalog Data
- **Scenario**: ConfigAttribute with `attribute_type = 'product'` or `'product_variant'` and `product_filter_id` pointing to a catalog category. If that category is empty or deleted, the configurator shows no options
- **Severity**: Low
- **Affected area**: Configurator UI for dynamic-catalog attribute types
- **Mitigation**: `product` type queries CatalogProduct filtered by category (`/api/catalog/products?categoryIds=`). `product_variant` type uses a two-step picker: first step fetches CatalogProducts under the same category (`/api/catalog/products?categoryIds=`); second step fetches variants of the picked product (`/api/catalog/variants?productId=`). Empty result at either step = show "No products/variants available" message (not error). Deleted category = `product_filter_id` becomes an orphaned FK reference — show "Configure product source" prompt. Form never blocks — other attributes remain fillable
- **Residual risk**: None — graceful degradation

#### Dynamic Resolution Failures Surface at Runtime, Not Save
- **Scenario**: A user fills a configuration snapshot with a value whose code does not match any CatalogProduct or CatalogProductVariant (typo, deleted catalog row, wrong category), or leaves a mandatory attribute unset that drives a BomLine's `product_resolve_key`
- **Severity**: Low
- **Affected area**: Resolution engine output fidelity; downstream BOM explosion
- **Mitigation**: Two-layer enforcement (see Design Decision #4). Save-time: snapshot keys validated against `ConfigAttribute.key` (warning, not block). Runtime: BOM explosion Step 2 type-directed lookup emits a per-line warning (missing key, missing UUID, wrong attribute type, or ID not found) and emits the output line with `productId === null`. MRP, purchasing, work orders must filter lines with `productId === null` out of planning; the UI surfaces them with muted styling so the user can see what's missing
- **Residual risk**: User must trust the warnings panel to catch unresolved lines before creating a downstream work order. Planning-time consumers must honor the `productId !== null` contract

#### Incomplete Configuration Data
- **Scenario**: Product has attributes but no constraint rules. Or has rules but some reference attributes not yet created. Or configSnapshot is partial (not all mandatory attributes filled)
- **Severity**: Low
- **Affected area**: Resolution output completeness
- **Mitigation**: Per Graceful Incompleteness. No rules = resolution is passthrough (snapshot → variant conditions directly). Rules referencing unknown attributes = skip rule, add warning. Partial snapshot = resolve what's available, warn about missing mandatory attributes. Errors only for explicit exclude_combination violations
- **Residual risk**: None — intended design

## Final Compliance Report — 2026-04-04

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | product_id is UUID FK to CatalogProduct. No ORM relation to BOM or routing entities — namespace rule enforced at application level |
| root AGENTS.md | Filter by organization_id | Compliant | All entities have organization_id + tenant_id |
| root AGENTS.md | Validate inputs with Zod | Compliant | data/validators.ts with type-specific validation per attribute_type and action_type |
| root AGENTS.md | API routes MUST export openApi | Compliant | Via makeCrudRoute + custom endpoints with explicit openApi |
| root AGENTS.md | Write operations via Command pattern | Compliant | 6 commands with undo contracts |
| root AGENTS.md | Event IDs: module.entity.action (singular, 3-level) | Compliant | configurator.config_attribute.created, configurator.constraint_rule.updated, etc. Module name as prefix per OM convention |
| root AGENTS.md | DB schema ADDITIVE-ONLY | Compliant | All new tables |
| root AGENTS.md | ACL feature IDs FROZEN once created | Compliant | New features (configurator.*) |
| packages/core AGENTS.md | setup.ts: declare defaultRoleFeatures | Compliant | admin: configurator.*, employee: configurator.view |
| packages/core AGENTS.md | Translatable fields in translations.ts | Compliant | ConfigAttribute.label, ConfigAttribute.attribute_group, ConstraintRule.description declared as translatable. Zero cost no-op if unused |
| packages/core AGENTS.md | validateCrudMutationGuard on writes | Compliant | All CRUD routes |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | 2 CRUD resources + resolve + validate-namespace match 2 entities + 2 algorithms |
| API contracts match UI/UX section | Pass | Configurator tab consumes CRUD + resolution + namespace APIs |
| Risks cover all write operations | Pass | CRUD, resolution, namespace rename impact, cascading loops |
| Commands defined for all mutations | Pass | 6 commands with undo |
| Cache strategy covers all read APIs | N/A | Resolution is pure computation, no caching needed. Attribute/rule CRUD is standard |

### Verdict

**Fully compliant** — ready for implementation.

## Final Compliance Report — 2026-04-17 (amendment: dynamic product attribute types)

Incremental review covering the 2026-04-17 changes (`attribute_type` enum split, `material_filter_id` rename, runtime namespace rule, UUID-valued snapshot + type-directed Step 2 resolution, Test Configuration preview, D-UI-8/9/10). All prior compliance findings remain valid.

### AGENTS.md Files Reviewed (delta)
- `AGENTS.md` (root) — Contract Surfaces §8 (DB schema additive-only), §2 (type definitions), Backward Compatibility
- `packages/core/AGENTS.md` — enum handling, ACL, events
- `packages/shared/AGENTS.md` — Zod validator shape per `attribute_type`
- Companion: `2026-04-03-manufacturing-product-foundation-b.md` §BOM Explosion Algorithm / Step 2 — cross-spec contract for runtime resolution

### Compliance Matrix (delta)

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md §8 | DB schema additive-only | Compliant — pre-release exception | Rename `material_filter_id` → `product_filter_id` and enum value `'material'` dropped from `attribute_type` via BC option A agreed 2026-04-17 (pre-release package). Hand-written migration |
| root AGENTS.md §2 | Enum values STABLE once shipped | Compliant — pre-release exception | `attribute_type` adds `'product'` + `'product_variant'` and removes `'material'`. Pre-release justification |
| root AGENTS.md | Singular naming | Compliant | `product`, `product_variant`, `product_filter_id`, `product_resolve_key` — all singular |
| root AGENTS.md | FK IDs for cross-module links | Compliant | `product_filter_id` is UUID FK to CatalogCategory; no ORM relation. Runtime resolution references CatalogProduct / CatalogProductVariant by UUID only |
| root AGENTS.md | Zod validation | Compliant | Type-specific branches updated: `product` and `product_variant` accept `product_filter_id` (nullable UUID); `allowed_values` null for both; save-time key validation emits warning only |
| root AGENTS.md | Tenant isolation (`organization_id`) | Compliant | Unchanged — ConfigAttribute / ConstraintRule inherit tenant scoping |
| root AGENTS.md | Command pattern for mutations | Compliant | No new commands — existing `configurator.config_attribute.*` and `configurator.constraint_rule.*` commands cover the updated fields |
| root AGENTS.md | Undo contract | Compliant | Command undo restores previous field values; the enum change and rename participate automatically |
| root AGENTS.md | Event IDs: module.entity.action (singular) | Compliant | No new events; unresolved-line information travels via the BOM explosion `warnings[]` array per 2026-04-17 decision (no `bom.bom_line.unresolved` event introduced) |
| root AGENTS.md | API response additive | Compliant — pre-release exception | `GET /api/manufacturing/config-attribute` returns renamed `product_filter_id` + new enum values. Pre-release rename |

### Internal Consistency Check (delta)

| Check | Status | Notes |
|---|---|---|
| Data model matches API contracts | Pass | ConfigAttribute column rename + enum split consistent across data/validators/endpoints |
| API contracts match UI/UX | Pass | Attribute editor dialog (conditional fields for `product` vs `product_variant`), ConfigurationForm input mapping, Test Configuration dialog all aligned |
| Runtime contract with sub-spec b | Pass | Step 2 in sub-spec b consumes configurator output — type-directed lookup by UUID; unresolved lines signal via `productId === null` + per-line entry in `result.warnings[]` (no dedicated status field). Single input (`variantConditions`) shared across Steps 1 / 2 / 3 |
| Risks cover new surfaces | Pass | Rewrote *Product / ProductVariant Attribute Types Depend on Catalog Data*; added *Dynamic Resolution Failures Surface at Runtime, Not Save* |
| Tests cover new branches | Pass | D-UI-2 expanded to cover both new types; D-UI-8/9/10 added for end-to-end type-directed resolution (`product_variant` branch, `product` branch, unresolved partial explosion) |

### Migration & Backward Compatibility (option A — pre-release rename)

Packages/manufacturing is not shipped to third parties. BC contract applies to released platform surfaces; pre-release changes within a feature branch before publication are in scope. The hand-written migration must:
1. Rename `config_attribute.material_filter_id` → `config_attribute.product_filter_id`.
2. Update the `attribute_type` CHECK constraint (if present) to accept `'enum'`, `'numeric_range'`, `'boolean'`, `'text'`, `'product'`, `'product_variant'` — remove `'material'`.
3. Data: no rows in production (pre-release). If any test-tenant rows exist with `attribute_type = 'material'`, map them to `'product'` + `'product_variant'` by hand based on whether the existing `material_filter_id` targets a category of Products with or without variants.

### Verdict

**Fully compliant** — amendment ready for implementation (code pass is a follow-up task).

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — Entities + CRUD | Done | 2026-04-05 | All module files, entities, validators, commands, CRUD routes, events, ACL, setup, search, translations, DI |
| Phase B — Resolution Engine + Namespace Validation | Done | 2026-04-05 | config-resolution.ts pure function, resolve endpoint, namespace-validator.ts, validate-namespace endpoint |
| Phase C — UI Widget + Tests | Done | 2026-04-13 | 50 unit tests + 7 integration tests. All UI components, hooks, and endpoints implemented |

### Phase A — Detailed Progress
- [x] Step 1: Create `src/modules/configurator/` with index.ts, acl.ts, events.ts, setup.ts, di.ts, search.ts, translations.ts
- [x] Step 2: Create `data/entities.ts` with ConfigAttribute, ConstraintRule
- [x] Step 3: Create `data/validators.ts` with Zod schemas
- [x] Step 4: Create `translations.ts` declaring translatable fields
- [x] Step 5: Create `search.ts` with searchConfig for ConfigAttribute
- [x] Step 6: Hand-write migration (Migration20260404000004)
- [x] Step 7: Create CRUD routes for config-attribute and constraint-rule
- [x] Step 8: Update `packages/manufacturing/src/index.ts` to export configurator module

### Phase B — Detailed Progress
- [x] Step 1: Create `lib/config-resolution.ts` — pure function
- [x] Step 2: Create `api/manufacturing/configurator/resolve.ts` — resolution endpoint
- [x] Step 3: Create `api/manufacturing/configurator/validate-namespace.ts` — namespace validation endpoint
- [x] Step 4: Create `lib/namespace-validator.ts` — pure function

### Phase C — Detailed Progress
- [x] Unit tests for config-resolution.ts (20 tests)
- [x] Unit tests for namespace-validator.ts (5 tests)
- [x] Unit tests for validators.ts (11 tests)
- [x] Module structure tests (14 tests)
- [x] ConfiguratorTab.tsx component (thin shell — visibility logic + renders AttributesSection)
- [x] AttributesSection.tsx component (DataTable + CRUD dialogs + delete impact warning + Test Configuration dialog — self-contained for future catalog injection)
- [x] ConfigurationForm dynamic component (5 attribute_type input branches, exported for sub-spec b/c)
- [x] `GET /api/configurator/manufacturing/config-attribute/usage?id=` endpoint
- [x] `POST /api/configurator/manufacturing/config-attribute/reorder` endpoint (atomic swap)
- [x] useConfigAttributeKeys hook (for sub-spec b/c namespace validation)
- [x] useIsConfiguratorReady hook (for foundation Overview readiness checklist)
- [x] Integration tests D-UI-1 through D-UI-7 (API-first Playwright tests)

---

## Changelog

### 2026-04-18
- **Two-step picker for `product_variant` in ConfigurationForm.** The `product_variant` row in §Configurator Form was originally specified with a single `ComboboxInput` against a hypothetical `/api/catalog/product-variants?categoryIds=<uuid>` endpoint. That endpoint does not exist in core (`packages/core/src/modules/catalog/api/variants/route.ts` supports `productId` filtering but not `categoryIds`), and the canonical route name is `/api/catalog/variants`, not `/api/catalog/product-variants`. Rather than add a parallel route or teach the existing one to filter by category, the UI now renders two stacked `ComboboxInput`s: step 1 picks a CatalogProduct from the filter category via the existing `/api/catalog/products?categoryIds=` endpoint; step 2 picks a CatalogProductVariant of that product via the existing `/api/catalog/variants?productId=` endpoint. The step-1 product selection is UI-only scope and is NOT part of the emitted snapshot — the submitted value remains `CatalogProductVariant.id` (UUID), preserving the sub-spec b Step 2 contract byte-for-byte. Runtime explosion is unchanged. Added a third fallback for "picked product has no variants" ("No variants on the selected product — pick a different product") and a one-shot variant → product hydration path when the form is opened with a default_value already set. D-UI-2 and D-UI-8 updated to exercise the two-step click flow and assert snapshot scope isolation. Rationale: natural fit for the fabric-collection-then-color mental model, zero core changes, no new API surface.

### 2026-04-17
- **`attribute_type` enum split.** Dropped `'material'`; added `'product'` (resolves to CatalogProduct, no variants) and `'product_variant'` (resolves to CatalogProductVariant). Same `product_filter_id` field scopes both to a catalog category.
- **`material_filter_id` → `product_filter_id`.** Rename applies to the column, Zod schema, attribute editor dialog, and ConfigurationForm type→input mapping.
- **Namespace rule — two layers (Design Decision #4 updated).** Save-time remains a warning (Graceful Incompleteness). Runtime adds a soft-error path: BOM explosion Step 2 in sub-spec b emits the output line with `productId === null` and appends a per-line warning to `result.warnings[]` when the resolve key is missing from `variantConditions`, the supplied UUID is not found in the target catalog table, or the ConfigAttribute's `attribute_type` cannot drive dynamic resolution. Explosion continues (partial result); MRP/WO/purchasing must filter lines with `productId === null` out of planning.
- **ConfigurationForm input table.** `material` row replaced by two rows: `product` (ComboboxInput over CatalogProduct) and `product_variant` (ComboboxInput over CatalogProductVariant). Selected value = `CatalogProduct.id` or `CatalogProductVariant.id` (UUID), consumed by sub-spec b Step 2 type-directed lookup.
- **Snapshot values are UUIDs, not codes.** ConfigurationForm combobox emits the selected entity's `id` (standard OM behavior). Sub-spec b's Step 2 uses `attribute_type` on the ConfigAttribute to pick the correct catalog table and looks up by UUID — no code-to-entity disambiguation, no fallback table. Design Decision #5 captures this as the OM-native approach (UUID-valued snapshots are consistent with OM-wide UUID conventions).
- **`resolvedConditions` shape simplified.** Dropped the single-element-array wrapping. Output is now `Record<string, string>` — one selected value per key — matching the new shape of sub-spec b's `ExplosionInput.variantConditions`. Only filter columns (`BomLine.variant_condition`, `OperationTemplateVariant.variant_condition`) keep arrays, where they meaningfully express "active for any of these values"; user selections do not.
- **Removed `Market Reference` blockquote** from §Proposed Solution (Carbon ERP / SAP LO-VC / Epicor CPQ / D365 attributions against 13 reference systems). Comparative-research framing not consistent with OM's spec style. The relevant Carbon ERP attribution already lives in the Rationale column of Design Decision #5 where it's architecturally load-bearing.
- **Attributes section type badge + values rendering.** Badge now shows `product` / `product_variant` instead of `material`; values column preview updated.
- **Integration tests.** D-UI-2 expanded to 6 types. D-UI-8 added (end-to-end `product_variant` type-directed branch). D-UI-9 added (type-directed `product` branch). D-UI-10 added (unresolved partial-explosion soft-error path).
- **Risks.** Rewrote *Product / ProductVariant Attribute Types Depend on Catalog Data* (was: *material Attribute Type Depends on Catalog Data*). Added *Dynamic Resolution Failures Surface at Runtime, Not Save*.
- **Migration.** Hand-written per external-package playbook — column rename + `attribute_type` CHECK update. Pre-release BC exception justified in 2026-04-17 amendment compliance report.

### Review — 2026-04-17
- **Reviewer**: Agent (spec-writing skill)
- **Security**: Passed — no new auth surfaces; ACL unchanged; resolution remains a pure function
- **Performance**: Passed — `product_filter_id` scopes the combobox category lookup; Step 2 adds one lookup per dynamic BomLine per explosion level
- **Cache**: N/A — resolution is pure computation, no caching
- **Commands**: Passed — no new commands; existing `configurator.config_attribute.*` cover the updated columns with undo
- **Risks**: Passed — new risk mitigations and residuals documented
- **Verdict**: Approved — pending code pass (tracked separately)

### 2026-04-13
- **Phase C UI implemented**: ConfiguratorTab (thin shell with variant_based/rule_based/none branches), AttributesSection (full CRUD DataTable with pill-styled enum values, inline reorder arrows, CrudForm dialog with type-reactive fields, tags input for enums, delete with usage-check confirmation, Test Configuration dialog), ConfigurationForm (dynamic form with 5 type branches, fieldset grouping, ComboboxInput for material, Cmd+Enter submit), useConfigAttributeKeys and useIsConfiguratorReady hooks. New endpoints: atomic reorder (`POST config-attribute/reorder`) and usage count (`GET config-attribute/usage?id=`). Tab persistence via URL hash. Spec updated for reorder UX, material ComboboxInput, query-param usage endpoint, text regex deferred.

### 2026-04-12
- **ConstraintRule UI deferred**: Stripped constraint rules section (§3), rule-specific tests (D-UI-3/4 replaced), and cascading loops risk from Phase C scope. ConstraintRule entity/API remain implemented — only the management UI and rule evaluation in resolution preview are deferred. Resolution preview simplified to passthrough mode (attribute values → variant conditions directly). Sub-spec b reference updated.

### 2026-04-11
- **Phase C expansion**: Migrated detailed Configurator tab UI spec from `2026-04-05-manufacturing-ui-foundation.md` (foundation UI spec refactor). Added ConfiguratorTab component contract, Attributes/Rules section layouts, ConfigurationForm type→input mapping, useConfigAttributeKeys + useIsConfiguratorReady hook exports, and 7 integration tests (D-UI-1..7). Phase C status: Partial → In Progress.

### 2026-04-06
- Wording improvements throughout

### 2026-04-05
- Implemented Phases A, B, C (backend). 50 unit tests passing. Migration hand-written. UI widget deferred.

### 2026-04-04
- Initial sub-spec. 2 entities (ConfigAttribute, ConstraintRule). Configuration resolution engine with constraint evaluation and cascading. Namespace rule enforcement. 3-phase implementation plan. Completes the product foundation spec family (a→d)
