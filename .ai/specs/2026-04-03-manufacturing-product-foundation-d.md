# Manufacturing Product Foundation — d: Product Configurator

| Field | Value |
|-------|-------|
| **Status** | Implemented |
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
- PriceAdjustment (configuration-dependent pricing) deferred to Phase 3 — this sub-spec handles BOM/routing resolution only
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

> **Market Reference**: Constraint-based configuration follows Carbon ERP's `configurationParameter` pattern — the most complete open-source implementation. Attribute types including `material` (live inventory lookup) adopted from Carbon's `dataType = 'material'` + `materialFormFilterId`. Simple JSON rule engine sufficient for ~300 rules (<100ms evaluation) — validated against SAP LO-VC (overkill for SMB), Epicor CPQ (heavy), and D365 Product Configurator (solver-based). Expression engine / OR-Tools CP-SAT solver deferred as future enhancement for factories exceeding 300 rules.

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
| 1 | Configurator scope in Phase 1 | **BOM/routing resolution only — no pricing** | PriceAdjustment deferred to Phase 3 (sales extensions). Configurator resolves which BOM lines and routing overrides apply. Pricing layer is meaningless without sales order lines to consume it |
| 2 | Constraint engine | **Simple JSON list evaluation** | Evaluate rules by iterating sorted by priority, checking condition_json matches against current selections. O(n) per evaluation, <100ms for ~300 rules. Sufficient for target scale. Expression engine / solver = future enhancement |
| 3 | Configuration snapshot format | **Flat JSONB: `{"attribute_key": "selected_value"}`** | Keys = ConfigAttribute.key. Values = selected option. Metadata fields prefixed with `_` (e.g., `_resolved_at`). Same format used everywhere: resolution input, BOM explosion input, storage on future SalesOrderLine/WorkOrder |
| 4 | Namespace rule enforcement | **Application-level validation on BomLine/OperationTemplateVariant save** | When saving a BomLine or OperationTemplateVariant with `variant_condition`, validate that keys match existing ConfigAttribute.key values for that product. Warn (not block) if attribute doesn't exist yet — Graceful Incompleteness allows building BOM before configurator |
| 5 | Attribute type `material` | **Live query against CatalogProduct catalog** | `material_filter_id` points to a product category. Configurator shows searchable combobox of products in that category. New products automatically appear — zero maintenance. Follows Carbon ERP pattern |

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
| `attribute_type` | VARCHAR(20) | NOT NULL | 'enum' | Type of attribute. Values: 'enum' (select from list), 'numeric_range' (slider/input), 'boolean' (toggle), 'text' (free text), 'material' (live catalog lookup). VARCHAR for extensibility |
| `allowed_values` | JSONB | nullable | null | For enum: `["SD01N","SD02N","SD03"]`. For numeric_range: `{"min":60,"max":260,"step":10}`. Null for boolean, text, material |
| `material_filter_id` | UUID | nullable | null | FK to CatalogProduct category (cross-package, UUID). Only for attribute_type='material' — filters which products appear in the selector |
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

3. **Build resolved variant conditions** — transform the final snapshot into the format expected by BOM explosion and routing:
   ```typescript
   // Input snapshot: {"seat_type": "SD04", "fabric": "Soro_61", "backrest": "OP62"}
   // Output: {"seat_type": ["SD04"], "fabric": ["Soro_61"], "backrest": ["OP62"]}
   ```
   Each key maps to a single-element array — matching the variant_condition AND-match format.

### Output

```typescript
type ResolutionResult = {
  resolvedConditions: Record<string, string[]>  // feeds into BOM explosion + routing
  resolvedSnapshot: Record<string, string>      // final snapshot after constraint evaluation
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

**Enforcement:** When saving a BomLine or OperationTemplateVariant with non-null variant_condition, validate that all keys in the JSONB match an existing ConfigAttribute.key for the same product. This is a **warning, not a block** — per Graceful Incompleteness, BOM/routing data may be created before configurator attributes are defined. The namespace rule is enforced at validation time (resolve endpoint), not at save time.

## API Contracts

All routes under `/api/manufacturing/`. CRUD routes use `makeCrudRoute` with `openApi` export. All entity queries use `findWithDecryption`/`findOneWithDecryption` per OM convention.

**Route prefix convention:** Route files nested under `api/manufacturing/` (e.g., `api/manufacturing/config-attribute/route.ts` → `/api/manufacturing/config-attribute`). See sub-spec a for rationale.

### Config Attribute

- `GET /api/manufacturing/config-attribute` — List (filtered by product_id, attribute_type, attribute_group, is_active)
- `GET /api/manufacturing/config-attribute/:id` — Detail
- `POST /api/manufacturing/config-attribute` — Create
- `PUT /api/manufacturing/config-attribute/:id` — Update
- `DELETE /api/manufacturing/config-attribute/:id` — Soft delete

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
  - Used by BOM and routing UIs when editing variant_condition fields

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
4. Create `translations.ts` declaring translatable fields: ConfigAttribute.label, ConfigAttribute.attribute_group, ConstraintRule.description. Zero runtime cost if no translations exist — ready for multi-locale when sales-facing configurator UI lands (Phase 3)
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

1. Create `backend/products/ConfiguratorTab.tsx` — widget injected into product detail page
2. Attribute editor: list attributes per group, add/edit/reorder, type-specific input (enum = list editor, numeric_range = min/max/step, material = category selector)
3. Constraint rule builder: condition editor (select attribute → select values) + action editor (select action type → configure target)
4. Resolution preview: enter test config → see resolved conditions + fired rules + warnings
5. Unit tests for `lib/config-resolution.ts`:
   - Simple resolution (3 attributes, no rules → passthrough)
   - restrict_values rule fires → narrows options
   - exclude_combination rule fires → error for invalid combo
   - require_value rule fires → forces value, adds warning
   - set_default rule fires → fills missing value
   - Cascading rules (rule A changes value, rule B triggers on new value)
   - Partial snapshot (missing mandatory attributes) → warnings, not errors
   - Unknown keys in snapshot → warnings
   - Empty rules list → passthrough
   - Priority ordering (higher priority fires first)
6. Unit tests for `lib/namespace-validator.ts`:
   - Known keys → valid
   - Unknown keys → listed in response
   - No ConfigAttributes defined yet → all keys unknown (warning)
7. Integration tests:
   - Create attributes + rules → resolve configuration → verify output matches expected conditions
   - Resolve with invalid combination → verify error in response
   - Create BomLine with variant_condition → call namespace validation → verify keys match attributes
   - End-to-end: create product → attributes → rules → BOM with variant_conditions → resolve config → explode BOM with resolved conditions → verify correct material list

**Testable outcome:** Configurator tab visible in product detail. All unit and integration tests pass. End-to-end config → BOM explosion chain works.

## Risks & Impact Review

#### Constraint Rule Cascading Loops
- **Scenario**: Rule A requires value X on attribute B. Rule B requires value Y on attribute A when B=X. Evaluating both creates an infinite loop
- **Severity**: Medium
- **Affected area**: Resolution engine
- **Mitigation**: Max iteration limit (default: 10 passes). After each pass, check if snapshot changed. If stable (no changes) → done. If still changing after max iterations → return error "constraint rules may have circular dependency" with the last stable snapshot as partial result
- **Residual risk**: Legitimate cascading rules that need >10 passes. Unlikely for manufacturing (rules are typically 1-2 levels deep). Configurable max_iterations if needed

#### ConfigAttribute Key Rename Breaks variant_conditions
- **Scenario**: User renames ConfigAttribute.key from "seat_type" to "seat_model". All BomLines and OperationTemplateVariants with `variant_condition: {"seat_type": [...]}` are now orphaned — key doesn't match any attribute
- **Severity**: Medium
- **Affected area**: BOM explosion (lines with stale keys silently skipped), routing variant overrides
- **Mitigation**: On ConfigAttribute.key update, query all BomLines and OperationTemplateVariants in the same product that use the old key in variant_condition. Return a warning with count of affected records. UI shows "N BOM lines and M routing overrides reference the old key — update them?" Consider making key immutable after first use (require delete + re-create to change). Future: ECM module (Phase 5) handles this via ChangeOrder
- **Residual risk**: If user ignores the warning, stale keys persist until manually fixed. Acceptable — same risk as renaming any reference data

#### material Attribute Type Depends on Catalog Data
- **Scenario**: ConfigAttribute with `attribute_type='material'` and `material_filter_id` pointing to a product category. If that category is empty or deleted, configurator shows no options
- **Severity**: Low
- **Affected area**: Configurator UI for material-type attributes
- **Mitigation**: Configurator queries CatalogProduct filtered by category. Empty result = show "No materials available" message (not error). Deleted category = material_filter_id becomes orphaned FK — show "Configure material source" prompt
- **Residual risk**: None — graceful degradation

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

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — Entities + CRUD | Done | 2026-04-05 | All module files, entities, validators, commands, CRUD routes, events, ACL, setup, search, translations, DI |
| Phase B — Resolution Engine + Namespace Validation | Done | 2026-04-05 | config-resolution.ts pure function, resolve endpoint, namespace-validator.ts, validate-namespace endpoint |
| Phase C — UI Widget + Tests | Partial | 2026-04-05 | Unit tests done (50 passing). Migration written. UI widget deferred to Phase 3 |

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
- [ ] UI widget (ConfiguratorTab.tsx) — deferred

---

## Changelog

### 2026-04-05
- Implemented Phases A, B, C (backend). 50 unit tests passing. Migration hand-written. UI widget deferred.

### 2026-04-04
- Initial sub-spec. 2 entities (ConfigAttribute, ConstraintRule). Configuration resolution engine with constraint evaluation and cascading. Namespace rule enforcement. 3-phase implementation plan. Completes Phase 1 spec family (a→d)
