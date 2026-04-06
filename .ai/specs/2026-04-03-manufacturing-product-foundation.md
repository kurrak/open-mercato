# Manufacturing — Product Foundation

| Field | Value |
|-------|-------|
| **Status** | In Progress |
| **Created** | 2026-04-03 |
| **Type** | Multi-part spec family (main + 4 sub-specs) |
| **Mode** | External Extension (`packages/manufacturing`) |
| **Builds on** | `packages/core/src/modules/catalog` (via UMES extension) |
| **Related** | — |
| **Domain research** | 13 ERP systems benchmarked (SAP, D365, Epicor, Infor, NetSuite, Acumatica, Odoo, ERPNext, Katana, MRPeasy, Carbon) |
| **Sub-specs** | a: Scaffold, b: BOM, c: Routing, d: Configurator |

> **New to manufacturing terminology?** See the [Glossary](#glossary) at the end of this document for definitions of BOM, MTO, MRP, DAG, and other terms.

---

## TLDR

**Key Points:**
- Add discrete manufacturing product definition to Open Mercato via an external extension package (`packages/manufacturing`). A factory owner defines a product with its bill of materials, production routing, work centers, and configurator — all visible from a single product card.
- Pure product definition layer — no scheduling, no execution, no inventory, no sales integration. Those are later phases (2–5).

**Scope:**
- New package: `@open-mercato/manufacturing`
- 4 product extension fields on CatalogProduct (configuration_type, procurement_type, base_uom_id, is_phantom_default)
- 16 new entities + 1 extended across 4 increments: product_master (5 new + 1 extension), BOM (3), routing (6), configurator (2)
- BOM explosion algorithm with phantom pass-through and variant-conditional resolution
- Operation dependency graph (DAG) for parallel manufacturing paths
- Configuration resolution engine: resolves customer choices into variant conditions before BOM explosion
- Widget injection into catalog product detail page (BOM tab, routing tab, configurator tab)

**Concerns:**
- Catalog extension is the heaviest UMES surface in the project — extension table + enrichers + widget injection on OM's most used entity
- BOM explosion is algorithmically complex (recursive, multi-level, phantom, variant-conditional, date-effective) — needs heavy unit test coverage
- Increments 2 (BOM) and 3 (Routing) have a nullable FK link (BomLine.operation_template_id) that gets wired after both land — must not break BOM explosion in the interim

---

## Overview

Open Mercato is a commerce/ERP platform with a mature catalog (11 entities), sales (20 entities), and workflow (6 entities) layer. It has no manufacturing capability. This module adds discrete manufacturing product definition as the foundation for a full manufacturing ERP vertical.

This spec family adds the product definition layer — the foundation that all later manufacturing features (work orders, MRP, purchasing, quality) build on.

> **Market Reference**: Studied 13 ERP systems (SAP S/4HANA, SAP B1, D365 SCM, D365 BC, Epicor Kinetic, Infor SyteLine, NetSuite, Acumatica, Odoo, ERPNext, Katana, MRPeasy, Carbon ERP). Adopted: multi-level BOM with phantom pass-through (SAP/Epicor pattern), operation dependency graph over simple sequence numbers (SAP PLAS/AFFL pattern but native from start), Production Method as BOM↔Routing bridge (D365 BC pattern), constraint-based configurator (Carbon pattern). Rejected: single-level flat BOM (Katana/MRPeasy — insufficient for complex discrete manufacturing), coupled BOM+Routing in one entity (Epicor MOM — too rigid), JSONB staging for changes (anti-pattern from Odoo).

## Problem Statement

1. **No product structure beyond commerce.** OM's CatalogProduct holds title, SKU, price, variants, and media. A discrete manufacturer needs: what materials go into this product (BOM), what operations produce it (routing), where those operations happen (work centers), and how customer choices affect both (configurator). None of this exists.

2. **No multi-level decomposition.** Manufactured products are often assemblies of sub-assemblies, each with its own material list and production steps. OM has `CatalogProductVariantRelation` for e-commerce bundles, but manufacturing BOM requires: phantom pass-through, date-effective lines, variant-conditional activation, scrap/waste tracking, and operation-level material assignment.

3. **No production routing.** There is no concept of work centers, operation sequences, time standards, or dependency graphs in OM. Discrete manufacturing commonly has parallel paths (multiple sub-assemblies produced simultaneously, converging at a final assembly point) that cannot be modeled with simple sequence numbers.

4. **No product configuration for manufacturing.** OM's configurable products (`productType: 'configurable'`, `optionValues` JSONB on variants) handle e-commerce variant selection. Manufacturing configuration must resolve to different BOM lines and routing overrides — a fundamentally different data flow.

## Proposed Solution

Build `@open-mercato/manufacturing` as an external extension package. It extends OM's catalog via UMES (entity extensions, widget injection, response enrichers) and adds new manufacturing-specific entities with their own API routes, pages, and event namespace.

### Design Decisions

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 1 | Package vs multi-package | **Single package, multiple modules** | One package = shared ORM entity registry, single build, single version. Multiple modules (product_master, bom, routing, configurator + future: production_orders, mrp, costing, subcontracting, ecm) = granular ACL, events, search, setup per domain. Cross-module refs within package use UUID FKs (OM convention). ORM relations kept within module boundaries. Matches `packages/core` pattern (30+ modules) |
| 2 | Product extension strategy | **Extension table (not EAV, not column addition)** | Typed, queryable, zero migration conflict with OM catalog upgrades. Separate `product_manufacturing_extension` table with FK to `catalog_product.id` |
| 3 | Cross-package FK strategy | **UUID ID references, no ORM relations** | OM architecture rule. Manufacturing entities reference CatalogProduct by UUID string, fetch separately. Prevents coupling, enables independent module evolution |
| 4 | BomLineVariant dual mode | **DB CHECK + Zod validation** | `variant_id` XOR `variant_condition` — both enforcement levels for data integrity. DB-level CHECK constraint + application-level Zod schema validation |
| 5 | Phantom flag placement | **BomHeader, not Product** | Same product can be phantom in one context (MTO) and non-phantom in another (MTS buffer). Authoritative flag must be on BOM, not product master |
| 6 | Operation dependency model | **Directed acyclic graph (DAG), not sequence numbers** | Discrete manufacturing commonly has parallel paths converging at assembly — sequential numbering is insufficient. Native graph from start (cleaner than SAP's bolt-on parallel sequences) |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Use OM's CatalogProductVariantRelation for BOM | Designed for e-commerce bundles (A = 2B + 1C). No phantom logic, no date-effective lines, no variant-conditional activation, no scrap tracking, no operation linkage |
| Use OM's custom entities (EAV) for manufacturing data | Untyped, no relational integrity, no typed queries. Manufacturing data is highly relational (BOM→BomLine→BomLineVariant→OperationTemplate→WorkCenter) |
| Build manufacturing in `packages/core` | Violates OM's extension model. Manufacturing is a vertical, not a platform primitive. External package preserves upgrade path and keeps core lean for non-manufacturing users |
| One monolithic spec | ~2000+ lines, impossible to review or implement incrementally. Multi-part family enables parallel work on BOM + Routing |

## Architecture

### Package Structure

Each domain is a separate OM module within `packages/manufacturing`. Each module follows OM convention: flat `entities.ts`, own `acl.ts`, `events.ts`, `setup.ts`, auto-discovered API routes and pages.

```
packages/manufacturing/
  src/
    modules/
      product_master/                   # ── Product Master (Increment 1)
        index.ts                        #    Module metadata
        acl.ts                          #    product_master.view, product_master.edit
        events.ts                       #    product_master.production_method.*, product_master.supplier_info.*, etc.
        setup.ts                        #    Seed UoM catalog, default config
        di.ts                           #    DI registration
        data/
          entities.ts                   #    ProductManufacturingExtension, ProductionMethod, UnitOfMeasure, SupplierInfo, UomConversion
          validators.ts
          extensions.ts                 #    CatalogProduct extension link
          enrichers.ts                  #    Manufacturing summary on Product API
        api/
          production-method/route.ts
          unit-of-measure/route.ts
          supplier-info/route.ts
        backend/
          page.tsx                      #    /backend/manufacturing dashboard
        widgets/
          injection/                    #    Product detail widget injection spots
          injection-table.ts

      bom/                              # ── Bill of Materials (Increment 2)
        index.ts
        acl.ts                          #    bom.view, bom.create, bom.update, bom.delete, bom.explode
        events.ts                       #    bom.bom_header.*, bom.explosion.completed
        di.ts
        data/
          entities.ts                   #    BomHeader, BomLine, BomLineVariant
          validators.ts
        api/
          bom/route.ts
          bom/explode.ts                #    Async BOM explosion (queue worker)
        lib/
          bom-explosion.ts              #    Pure explosion algorithm
        workers/
          bom-explode.ts
        backend/
          products/BomTab.tsx           #    Widget injected into product detail

      routing/                          # ── Routing & Work Centers (Increment 3)
        index.ts
        acl.ts                          #    routing.view, routing.create, routing.update, routing.delete
        events.ts                       #    routing.routing_template.*, routing.work_center.*
        di.ts
        data/
          entities.ts                   #    RoutingTemplate, OperationTemplate, OperationTemplateVariant,
          validators.ts                 #    OperationDependency, WorkCenter, FactoryZone
        api/
          routing/route.ts
          routing/validate-graph.ts
          work-center/route.ts
          factory-zone/route.ts
        lib/
          dependency-graph.ts           #    DAG validation + traversal
        backend/
          products/RoutingTab.tsx       #    Widget injected into product detail

      configurator/                     # ── Product Configurator (Increment 4)
        index.ts
        acl.ts                          #    configurator.view, configurator.edit
        events.ts                       #    configurator.config_attribute.*, configurator.constraint_rule.*
        di.ts
        data/
          entities.ts                   #    ConfigAttribute, ConstraintRule
          validators.ts
        api/
          config-attribute/route.ts
          constraint-rule/route.ts
          configurator/resolve.ts       #    Configuration resolution endpoint
        lib/
          config-resolution.ts          #    Configuration resolution engine
        backend/
          products/ConfiguratorTab.tsx   #    Widget injected into product detail

      # ── Future modules (defined in later specs when needed)
      # production_orders/              #    WorkOrder, WorkOrderOperation, LaborEntry, ...
      # mrp/                            #    PlannedOrder, MrpRun
      # costing/                        #    CostEstimate, CostEstimateLine, ...
      # subcontracting/                 #    SubcontractOrder, SubcontractOrderLine
      # ecm/                            #    ChangeOrder, ChangeOrderLine, ...
```

### Extension Points Used

| UMES Mechanism | Module | Usage |
|---|---|---|
| Entity extension (`data/extensions.ts`) | product_master | 4 fields on CatalogProduct (configuration_type, procurement_type, base_uom_id, is_phantom_default) via separate extension table |
| Widget injection (`widgets/injection/`) | product_master | Product detail injection spots. BOM, routing, configurator modules inject their tabs into these spots |
| Response enricher (`data/enrichers.ts`) | product_master | Manufacturing summary on CatalogProduct API responses (has_bom, has_routing, production_method_count) |
| Events (`events.ts`) | each module | Per-module event declarations: bom module declares `bom.*`, routing declares `routing.*`, product_master declares `product_master.*`, configurator declares `configurator.*`. Module name = event prefix (OM convention) |
| ACL features (`acl.ts`) | each module | Per-module features: `product_master.view`, `product_master.edit` (product_master), `bom.create` (bom), `routing.view` (routing), `configurator.edit` (configurator) |

### Entity Dependency Graph

Module boundaries shown. ORM relations within modules (solid lines), UUID FKs across modules (dashed).

```
┌─ product_master module ────────────────────────────────┐
│  CatalogProduct (OM) ← [extension] ProductMfgExtension │
│  ProductionMethod ←── bridge entity                    │
│    ├─ bom_header_id ──────────→ BomHeader              │
│    └─ routing_template_id ────→ RoutingTemplate        │
│  UnitOfMeasure (standalone master catalog)             │
└────────────────────────────────────────────────────────┘
            PM owns FKs pointing into both modules:
┌──────────────────────┐  ┌──────────────────────────────┐
│  bom module          │  │  routing module              │
│  BomHeader           │  │  RoutingTemplate             │
│    ├─ BomLine ───────│──│─→ OperationTemplate (UUID)   │
│    │   └─BomLineVar  │  │    ├─ OpTemplateVariant      │
│    │                 │  │    └─→ WorkCenter (ORM)      │
│    └─ material: Cat- │  │  OperationDependency         │
│       alogProduct    │  │  WorkCenter → FactoryZone    │
│       (UUID FK)      │  │                              │
└──────────────────────┘  └──────────────────────────────┘
            │ namespace rule       │ namespace rule
┌───────────▼──────────────────────▼─────────────────────┐
│  configurator module                                   │
│  ConfigAttribute → CatalogProduct (UUID FK)            │
│  ConstraintRule → CatalogProduct (UUID FK)             │
└────────────────────────────────────────────────────────┘
```

Cross-module UUID FKs:
- `ProductionMethod.bom_header_id` → BomHeader (bom module) — PM owns this FK, not reverse
- `ProductionMethod.routing_template_id` → RoutingTemplate (routing module) — PM owns this FK, not reverse
- `BomLine.operation_template_id` → OperationTemplate (routing module, **nullable**)
- `BomLine.material_id` → CatalogProduct (OM catalog, cross-package)
- `ConfigAttribute.product_id` → CatalogProduct (OM catalog, cross-package)

### Event Namespace

All events use module-level prefix with singular entity names (per OM convention `module.entity.action`):

- `product_master.production_method.created|updated|deleted`
- `product_master.supplier_info.created|updated|deleted`
- `product_master.unit_of_measure.created|updated|deleted`
- `product_master.uom_conversion.created|updated|deleted`
- `bom.bom_header.created|updated|deleted`
- `bom.bom_line.created|updated|deleted`
- `bom.bom_line_variant.created|updated|deleted`
- `bom.explosion.completed` (payload: product_id, explosion result summary)
- `routing.routing_template.created|updated|deleted`
- `routing.operation_template.created|updated|deleted`
- `routing.operation_template_variant.created|updated|deleted`
- `routing.operation_dependency.created|updated|deleted`
- `routing.work_center.created|updated|deleted`
- `routing.factory_zone.created|updated|deleted`
- `configurator.config_attribute.created|updated|deleted`
- `configurator.constraint_rule.created|updated|deleted`
- `configurator.configuration.resolved` (payload: product_id, resolved config)

## Sub-Spec Roadmap

| Sub-Spec | Title | Entities | Depends On | Can Parallelize With |
|---|---|---|---|---|
| **a** | Product Master | ProductManufacturingExtension, ProductionMethod, UnitOfMeasure, SupplierInfo, UomConversion | — (first) | — |
| **b** | Bill of Materials | BomHeader, BomLine, BomLineVariant | a | c |
| **c** | Routing & Work Centers | RoutingTemplate, OperationTemplate, OperationTemplateVariant, OperationDependency, WorkCenter, FactoryZone | a | b |
| **d** | Product Configurator | ConfigAttribute, ConstraintRule | b + c | — |

```
    a (Scaffold)
    ├──→ b (BOM)      ─┐
    └──→ c (Routing)  ─┤──→ d (Configurator)
                       ┘
```

Each sub-spec follows the full OM lifecycle: `spec-writing` → `pre-implement-spec` → `implement-spec` → `code-review`.

## Data Models

> Detailed entity definitions (column-level, with types, nullable, FKs) are in each sub-spec. This section provides the summary for cross-referencing.

### Entity Count by Sub-Spec

| Sub-Spec | New Entities | Extended Entities |
|---|---|---|
| a | ProductionMethod, UnitOfMeasure, SupplierInfo, UomConversion | CatalogProduct (+4 fields via extension table) |
| b | BomHeader, BomLine, BomLineVariant | — |
| c | RoutingTemplate, OperationTemplate, OperationTemplateVariant, OperationDependency, WorkCenter, FactoryZone | — |
| d | ConfigAttribute, ConstraintRule | BomLine (config resolution drives line activation), OperationTemplateVariant (variant override resolution) |
| **Total** | **16 new** | **1 extended** |

### Shared Columns (all manufacturing entities)

Every entity includes: `id` (UUID PK), `organization_id` (FK, tenant scoping), `tenant_id`, `created_at`, `updated_at`, `deleted_at` (soft delete).

## API Contracts

> Detailed endpoint definitions (request/response schemas, error codes) are in each sub-spec. This section defines the shared API patterns.

### Base Path

All manufacturing APIs under `/api/manufacturing/`:

| Sub-Spec | Resource | CRUD Base | Custom Endpoints |
|---|---|---|---|
| a | production-method | `/api/manufacturing/production-method` | — |
| a | unit-of-measure | `/api/manufacturing/unit-of-measure` | — |
| b | bom | `/api/manufacturing/bom` | `POST /api/manufacturing/bom/explode` (async — queues worker, returns job ID) |
| c | routing | `/api/manufacturing/routing` | `POST /api/manufacturing/routing/validate-graph` |
| c | work-center | `/api/manufacturing/work-center` | — |
| c | factory-zone | `/api/manufacturing/factory-zone` | — |
| d | config-attribute | `/api/manufacturing/config-attribute` | — |
| d | constraint-rule | `/api/manufacturing/constraint-rule` | — |
| d | — | — | `POST /api/manufacturing/configurator/resolve` |

All CRUD routes use `makeCrudRoute` with `openApi` export. Custom endpoints use explicit route files with OpenAPI and mutation guards.

## User Stories

- **Production engineer** wants to **define a product with its material list (BOM)** so that **the system knows what goes into each product**
- **Production engineer** wants to **define production routing with work centers** so that **the system knows how and where each product is manufactured**
- **Production planner** wants to **see parallel production paths and convergence points** so that **planning reflects real manufacturing flow**
- **Production engineer** wants to **configure a product with customer-selectable options** so that **the BOM and routing automatically adjust per configuration**
- **Production manager** wants to **see everything about a product on one card** so that **information is not scattered across multiple views**
- **Production engineer** wants to **define phantom sub-assemblies** so that **materials pass through to the parent without creating separate inventory/work orders**

## Scope Boundaries

### In Scope

- Product manufacturing extensions (4 fields: configuration_type, procurement_type, base_uom_id, is_phantom_default)
- ProductionMethod (BOM↔Routing bridge)
- SupplierInfo (vendor per material — completes "what, how, where from" product definition)
- UomConversion (per-product unit conversions)
- Multi-level BOM with phantom, date-effective, variant-conditional lines
- BOM explosion algorithm (5-step with config resolution stub → real resolution in sub-spec d)
- Production routing with DAG dependency graph
- Work center and factory zone master data
- Unit of measure master catalog
- Product configurator (attributes, constraints, resolution engine)
- Widget injection into catalog product detail
- Manufacturing response enricher on CatalogProduct
- Basic change tracking via OM ActionLog (zero custom work — who changed what, when)
- Variant-based products via OM CatalogProductVariant (reused, no new entity)

### Explicitly Out of Scope

| Feature | Phase | Reason |
|---|---|---|
| Remaining product extension fields (11 fields) | 2–5 | Not consumed until inventory/WO/MRP/sales/ECM |
| Skill, OperationSkillRequirement | 3 | Consumed by WO assignment |
| OperationInstruction | 3 | Consumed by shop floor UI |
| PriceAdjustment | 3 | Consumed by sales order pricing |
| Inventory (Location, Lot, GoodsMovement) | 2 | Separate package |
| Work orders, scheduling | 3 | Depends on inventory + calendar |
| MRP engine | 4 | Depends on WO + purchasing |
| Costing (CostEstimate) | 4 | Depends on BOM + routing + supplier info |
| Quality control | 4 | Depends on lot + WO |
| Factory Calendar | 3 | Consumed by WO scheduling |
| AI Agent integration | Separate | Separate architecture track |

## Design Principle: Graceful Incompleteness

Manufacturing product data is built incrementally — element by element, over hours or days. At any moment, a product card is deliberately incomplete:

- BOM defined, routing not yet
- Production method exists with BOM but no routing (or vice versa)
- Some materials have supplier info, others don't yet
- Configurator attributes exist but constraint rules are still being added
- Products marked as "make" with no BOM at all (work in progress)

**This is not an error state — it's the normal state.** The system must treat incomplete data as first-class, not as a validation failure or degraded mode.

**Rules for all manufacturing modules:**

| Rule | Applies To | Example |
|---|---|---|
| Nullable FKs for cross-entity links | All entities | ProductionMethod.bom_header_id, BomLine.operation_template_id — null means "not yet linked", not "broken" |
| No required-completeness gates on save | CRUD operations | User can save a BomHeader with zero BomLines. Can save a RoutingTemplate with zero operations. Validation runs on *use* (explosion, scheduling), not on *save* |
| Algorithms handle missing data gracefully | BOM explosion, config resolution, DAG validation | BOM explosion skips lines with null material_id. Config resolution returns partial results if some attributes are undefined. DAG validation warns about disconnected nodes, doesn't reject them |
| UI shows completeness status, not errors | Product card, BOM tab, routing tab | "3 of 8 elements have BOM defined" — progress indicator, not error banner. Missing data shown as empty states with "add" affordances, not validation errors |
| Enrichers return meaningful defaults for incomplete data | Response enrichers | `_manufacturing: { has_bom: false, production_method_count: 0 }` — not null, not error |

## Risks & Impact Review

#### Catalog Extension Latency
- **Scenario**: Manufacturing enricher on CatalogProduct adds latency to product list API (N+1 on ProductionMethod count, BOM existence check)
- **Severity**: Medium
- **Affected area**: Catalog product list page (most-used backend page)
- **Mitigation**: Enricher uses batch loading (enrichMany). Cache manufacturing summary with tag `manufacturing:product:{id}`. Invalidate on PM/BOM create/update/delete
- **Residual risk**: First load after cache invalidation is slower. Acceptable for manufacturing use case (product list less critical than in e-commerce)

#### BOM Explosion Stack Overflow
- **Scenario**: Circular BOM reference (A contains B contains A) causes infinite recursion in explosion algorithm
- **Severity**: High
- **Affected area**: BOM explosion endpoint, MRP (future)
- **Mitigation**: (1) Application-level cycle detection during BOM save (reject circular references). (2) Explosion algorithm has max_depth parameter (default: 10, configurable). (3) Unit test with intentional cycle verifies rejection
- **Residual risk**: Edge case where cycle is introduced via concurrent edits — detected at explosion time, not save time. Acceptable: explosion returns error, does not hang

#### Widget Injection Spot Conflicts
- **Scenario**: Manufacturing widget injection into catalog product detail conflicts with other OM extensions (e.g., future e-commerce bundle editor)
- **Severity**: Low
- **Affected area**: Catalog product detail page layout
- **Mitigation**: Register manufacturing-specific spot IDs (`product-detail:manufacturing:bom`, `product-detail:manufacturing:routing`, `product-detail:manufacturing:configurator`). Don't override existing catalog spots. Use `InjectionPosition.After` relative to existing content
- **Residual risk**: Visual clutter if many extensions inject into same page. Acceptable: tab-based layout isolates sections

#### Incomplete Data as Normal State
- **Scenario**: Product data is built incrementally. At any point: BOM may exist without routing, production method may lack a BOM link, materials may have no supplier info. Every query, algorithm, and UI component encounters incomplete data as the common case, not the edge case
- **Severity**: Medium (pervasive — affects every module)
- **Affected area**: All CRUD, BOM explosion, enrichers, UI components
- **Mitigation**: Graceful Incompleteness principle (see above). Nullable FKs for all cross-entity links. Validation on use, not on save. Algorithms skip missing data and return partial results. UI shows completeness indicators, not errors. Each sub-spec must define behavior for every nullable FK and missing relationship
- **Residual risk**: Risk of inconsistent handling across modules if principle is not enforced in code review. Mitigation: add "incompleteness handling" as an explicit checklist item in code review gate

#### Extension Table Migration Ordering
- **Scenario**: `packages/manufacturing` migration runs before `packages/core/catalog` migration that creates the product table it references
- **Severity**: Medium
- **Affected area**: Fresh database setup, CI
- **Mitigation**: Extension table FK references `catalog_product.id` — standard MikroORM migration ordering handles this (core packages migrate first). Document in setup guide. Test with `yarn db:migrate` on clean database
- **Residual risk**: If OM changes catalog table name — caught by BC contract (DB schema is ADDITIVE-ONLY, table renames forbidden)

## Testing Strategy

> Detailed test scenarios in each sub-spec. Summary here for cross-referencing.

Three layers:
1. **Unit tests** — BOM explosion algorithm, DAG validation, configuration resolution engine. Pure logic, no DB
2. **Integration tests** — Playwright API-first, self-contained fixtures, create in setup, cleanup in finally. Tests in `packages/manufacturing/src/modules/<module>/__integration__/`. Detailed scenarios defined per sub-spec
3. **Reference fixture** — canonical test dataset modeling a complex assembled product (8 child elements, 13 work centers, 6 parallel paths, 20 config attributes)

Key integration test: full product card end-to-end — product → production method → BOM with variants → routing with parallel paths → configurator → explode with config snapshot.

## Final Compliance Report — 2026-04-03

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/search/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Manufacturing entities reference CatalogProduct by UUID FK, not ORM relation |
| root AGENTS.md | Filter by organization_id for tenant-scoped entities | Compliant | All entities include organization_id + tenant_id |
| root AGENTS.md | Use DI (Awilix) to inject services | Compliant | di.ts registers BomExplosionService, ConfigResolutionService, etc. |
| root AGENTS.md | Validate all inputs with Zod | Compliant | data/validators.ts for all entities |
| root AGENTS.md | API routes MUST export openApi | Compliant | All CRUD routes via makeCrudRoute + openapi.ts factory. Custom endpoints export explicit openApi |
| root AGENTS.md | Write operations via Command pattern | Compliant | Commands for BOM create/update/delete, routing CRUD, configurator CRUD |
| root AGENTS.md | Event IDs: module.entity.action (singular, past tense) | Compliant | `bom.bom_header.created`, `routing.operation_template.updated`, etc. Module name as prefix per OM convention |
| root AGENTS.md | Backward compatibility: event IDs FROZEN | Compliant | New namespace, no existing events modified |
| root AGENTS.md | Backward compatibility: DB schema ADDITIVE-ONLY | Compliant | All new tables. Extension table is separate from catalog_product |
| root AGENTS.md | Backward compatibility: widget spot IDs FROZEN | Compliant | New spot IDs (product-detail:manufacturing:*). No existing spots modified |
| root AGENTS.md | Backward compatibility: ACL feature IDs FROZEN | Compliant | New features (manufacturing.*). No existing features modified |
| root AGENTS.md | New integration providers in dedicated package | N/A | Not an integration provider |
| packages/core AGENTS.md | setup.ts: declare defaultRoleFeatures when adding features | Compliant | setup.ts seeds manufacturing features with admin/manager defaults |
| packages/core AGENTS.md | Entity extensions via data/extensions.ts | Compliant | ProductManufacturingExtension links to CatalogProduct |
| packages/core AGENTS.md | Widget injection via widgets/injection/ + injection-table.ts | Compliant | BomTab, RoutingTab, ConfiguratorTab registered |
| packages/core AGENTS.md | Custom fields: use collectCustomFieldValues() | N/A | No custom fields on manufacturing entities currently |
| packages/search AGENTS.md | Search config via search.ts | Compliant | BomHeader, WorkCenter, ProductionMethod searchable |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Entity summary matches API resource table. Detail in sub-specs |
| API contracts match UI/UX section | Pass | Widget tabs map to API resources |
| Risks cover all write operations | Pass | BOM create/explode, routing create/validate, config resolve all covered |
| Commands defined for all mutations | Pass | CRUD commands for all entities + explode + resolve |
| Cache strategy covers all read APIs | Pass | Manufacturing enricher cached with tag-based invalidation |

### Verdict

**Fully compliant** — ready for sub-spec writing and implementation.

---

## Glossary

Manufacturing terms used in this spec family. OM maintainers: this section is for you.

| Term | Full Name | What It Means |
|---|---|---|
| **BOM** | Bill of Materials | Hierarchical list of materials and sub-assemblies needed to make a product. Like a recipe — "to make a sofa you need: frame, foam, fabric, screws" |
| **Routing** | Production Routing | Ordered sequence of operations to manufacture a product. "First cut fabric, then sew covers, then upholster frame, then inspect" |
| **Work Center** | — | A physical workstation, machine, or area where an operation happens (e.g., CNC cutter, sewing station, assembly bench) |
| **Production Method** | — | Bridge entity pairing a specific BOM with a specific routing. A product can have multiple PMs (e.g., "make internally" vs "outsource to vendor") |
| **Phantom** | Phantom BOM / Phantom Assembly | A sub-assembly that exists in the BOM for organizational purposes but is never stocked or scheduled separately. During BOM explosion, its components "pass through" to the parent level |
| **BOM Explosion** | — | Algorithm that recursively flattens a multi-level BOM into a flat list of raw materials with quantities. Handles phantoms, date-effective lines, variant conditions |
| **MRP** | Material Requirements Planning | Algorithm that calculates what to make and what to buy, when, and how much — by exploding demand through BOMs, netting against inventory, and offsetting by lead times |
| **WO** | Work Order | Production order — instruction to manufacture a specific quantity of a product using a specific BOM + routing. Tracks progress through operations |
| **MTO** | Make to Order | Manufacturing policy: produce only when a customer order exists. Each WO is pegged (linked) to a specific sales order line |
| **MTS** | Make to Stock | Manufacturing policy: produce to maintain inventory buffer. WOs are triggered by reorder points or MRP, not individual orders |
| **ECM** | Engineering Change Management | Formal process for modifying product structure (BOM, routing). Changes staged, reviewed, approved before applying — prevents uncontrolled edits to production data |
| **NCR** | Non-Conformance Report | Document recording a quality defect — what failed, where, disposition (scrap, rework, use as-is, return) |
| **CAPA** | Corrective and Preventive Action | Follow-up to NCR: what caused the defect, what was fixed (corrective), what prevents recurrence (preventive) |
| **QC** | Quality Control | Inspection process: planned checks at receiving, in-process, or finished goods stages |
| **UoM** | Unit of Measure | Measurement unit for quantities (pieces, meters, kg). Products can have different UoMs for purchasing, production, and inventory |
| **MOQ** | Minimum Order Quantity | Smallest quantity a supplier will accept per purchase order |
| **Lead Time** | — | Calendar days from ordering to receiving (purchasing) or from starting to completing (manufacturing) |
| **ATP** | Available to Promise | Computed quantity available for new orders: on_hand − committed + scheduled_receipts. Informational, not blocking |
| **CPA** | Customer Product Assignment | Cross-reference mapping a customer's part number to an internal product. "Customer calls it X, we call it Y" |
| **Backflush** | — | Automatic material consumption: instead of manually recording each material issue, the system deducts BOM quantities when the operation is reported complete |
| **FEFO** | First Expired, First Out | Inventory picking strategy: use the lot with the earliest expiry date first |
| **OEE** | Overall Equipment Effectiveness | Manufacturing KPI: availability × performance × quality. Measures how well a work center is utilized |

---

## Changelog

### 2026-04-06
- Review fixes: FK direction reversal (PM owns bom_header_id and routing_template_id, BomHeader/RoutingTemplate no longer own reverse FK). Added is_phantom_default and service procurement type to extension entity (4 fields, was 3). Added production-method resolve endpoint. Completed event namespace (12 missing CRUD events added). Wording improvements throughout

### 2026-04-03
- Review feedback: added SupplierInfo + UomConversion to product_master (5 entities, was 3). ActionLog as basic change tracking (zero custom work). ProductVariant coverage explicit (OM CatalogProductVariant reused for variant_based). Total entities 18→20
- Revised to multi-module architecture within single package. 4 modules implemented (product_master, bom, routing, configurator) + 5 future modules (production_orders, mrp, costing, subcontracting, ecm). Updated package structure, entity dependency graph with module boundaries, extension points per module. Matches OM convention (packages/core has 30+ modules)
- Resolved open questions: async BOM explosion, extension table (not EAV). Removed Open Questions block. Promoted to Draft
- Initial skeleton spec. Multi-part family roadmap with 4 sub-specs (a–d). Architecture, entity graph, API surface, risks, compliance report
