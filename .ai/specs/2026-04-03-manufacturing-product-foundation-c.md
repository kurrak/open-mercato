# Manufacturing Product Foundation — c: Routing & Work Centers

| Field | Value |
|-------|-------|
| **Status** | In Progress |
| **Created** | 2026-04-04 |
| **Parent spec** | `2026-04-03-manufacturing-product-foundation.md` |
| **Mode** | External Extension (`packages/manufacturing`, module `routing`) |
| **Depends on** | Sub-spec a (product_master module — ProductionMethod) |
| **Parallel with** | Sub-spec b (BOM module — can be implemented independently) |
| **Sub-specs** | This is sub-spec **c** of 4 (a: Product Master, b: BOM, c: Routing, d: Configurator) |

---

## TLDR

**Key Points:**
- Add a `routing` module within `packages/manufacturing` for production routing: the sequence of operations, work centers, time standards, and payment structures needed to manufacture a product
- 6 new entities: RoutingTemplate, OperationTemplate, OperationTemplateVariant, OperationDependency, WorkCenter, FactoryZone
- Operation dependency graph (DAG) for parallel manufacturing paths converging at assembly — not sequential numbering
- 5 time components per operation (setup, run, teardown, queue, wait+move) with 3 payment models (hourly, piecework, base+piecework)
- Variant overrides on operations (different time/rate/work center per variant) using same XOR pattern as BOM module

**Scope:**
- Module: `src/modules/routing/` with full auto-discovery
- 6 entities with ORM relations within module (RoutingTemplate ↔ OperationTemplate ↔ OperationDependency, WorkCenter ↔ FactoryZone)
- CRUD APIs + DAG validation endpoint
- DAG validation algorithm in `lib/dependency-graph.ts` (cycle detection, convergence validation)
- Time rollup algorithm in `lib/time-rollup.ts` (pure function)
- Routing tab widget for product detail page
- Dependency graph visualization

**Concerns:**
- DAG validation must handle concurrent edits gracefully (parallel additions that create cycles)
- `WorkCenter.shift_calendar_id` is nullable FK to future `packages/calendar` — cross-package, wired when calendar package is implemented
- After both b and c land, `BomLine.operation_template_id` (in BOM module) can be wired to OperationTemplate (in this module)

---

## Overview

A production routing defines *how* a product is manufactured — the ordered operations, the work centers where they happen, the time each takes, and the labor cost structure. This module implements routing as a directed acyclic graph (DAG) of operations rather than a simple sequential list, because real manufacturing commonly has parallel paths converging at assembly.

The routing uses a Template → Variant Override pattern:
- **Template** = the default operation parameters (time, rate, work center) — one source of truth
- **Variant Override** = exceptions for specific variants (e.g., larger seat takes 60 min instead of 45) — only the difference is stored

## Problem Statement

1. **No routing or operation concept in OM.** There is no way to define how a product is manufactured — what operations, in what order, at what work centers, taking how long.

2. **Sequential numbering insufficient.** Real manufacturing has parallel paths. A sofa has 6 sub-assemblies produced simultaneously (seat, backrest, sides, frame, covers, upholstery) that all converge at a final assembly operation. Linear sequence numbers (10, 20, 30) cannot express "operations A, B, C, D, E all finish before F starts."

3. **No work center master data.** OM has no concept of physical workstations, their capacity, efficiency, or cost rates. This is needed for scheduling, costing, and shop floor execution.

4. **No variant-specific operation parameters.** Different product variants may require different processing times, different work centers, or different labor rates for the same operation. Without variant overrides, each variant needs a complete separate routing — data duplication that's unmaintainable.

## Proposed Solution

Add a `routing` module within `packages/manufacturing` with 6 entities, a DAG validation algorithm, and a time rollup calculator.

### Design Decisions

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 1 | Dependency model | **DAG (directed acyclic graph), not sequence numbers** | Real manufacturing has parallel paths converging at assembly. Native graph from start (parent spec decision #6) |
| 2 | Time model | **5 components per operation** | Setup, run, teardown are work-center occupation time. Queue, wait+move are non-occupation time. Scheduling needs both. Simpler models (just "run time") can't distinguish "machine is busy" from "part is drying" |
| 3 | Variant overrides | **OperationTemplateVariant with XOR dual mode** | Same pattern as BomLineVariant (sub-spec b): variant_id XOR variant_condition. Null override fields = inherit from base OperationTemplate |
| 4 | Payment types | **3 models: hourly, piecework, base+piecework** | Piecework is standard in discrete manufacturing (especially upholstery/assembly). Hourly for machine operations. Mixed for operations with guaranteed base + performance bonus |
| 5 | WorkCenter calendar FK | **Nullable FK to future packages/calendar** | Calendar not yet built. FK ready for wiring when calendar package is implemented. Scheduling without calendar = assumes 24/7 |

## Data Models

### WorkCenter

Physical workstation or machine where operations happen.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `name` | VARCHAR(255) | NOT NULL | — | Human label (e.g., "Foam station", "CNC cutting") |
| `code` | VARCHAR(50) | NOT NULL | — | Short code (e.g., "WC-PIAN", "WC-CNC"). UNIQUE per org+tenant |
| `factory_zone_id` | UUID | nullable | null | FK to FactoryZone (ORM relation — same module). Nullable per Graceful Incompleteness |
| `capacity` | INTEGER | NOT NULL | 1 | How many units can be processed simultaneously (1 = single machine, 3 = three sewing machines) |
| `efficiency_percent` | INTEGER | NOT NULL | 100 | Work center efficiency. 100 = standard. 80 = old machine (scheduler adjusts: 60 min operation takes 75 min). Range: 1–200 |
| `scheduling_mode` | ENUM('finite','infinite') | NOT NULL | 'infinite' | Infinite = no capacity checking (schedules freely). Finite = respects capacity limits. Start with infinite |
| `shift_calendar_id` | UUID | nullable | null | FK to future ShiftCalendar in packages/calendar (cross-package, UUID). Nullable until calendar module exists |
| `default_hourly_rate` | NUMERIC(18,4) | nullable | null | Default labor rate per hour for this work center. Nullable per Graceful Incompleteness |
| `overhead_rate_per_hour` | NUMERIC(18,4) | nullable | null | Machine/facility overhead per hour (depreciation, energy, tools). Used by future costing module |
| `is_active` | BOOLEAN | NOT NULL | true | Soft toggle |
| `notes` | TEXT | nullable | null | — |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Indexes:** `(organization_id, code)` UNIQUE for code lookup. `(organization_id, factory_zone_id)` for zone grouping.

### FactoryZone

Logical grouping of work centers by physical area or department.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `name` | VARCHAR(255) | NOT NULL | — | Zone name (e.g., "Carpentry hall", "Upholstery hall", "Sewing room") |
| `code` | VARCHAR(50) | NOT NULL | — | Short code (e.g., "ZONE-CARP", "ZONE-UPH"). UNIQUE per org+tenant |
| `location_id` | UUID | nullable | null | FK to future Location entity in packages/inventory (cross-package, UUID). Links zone to warehouse/WIP location. Nullable until inventory module exists |
| `is_active` | BOOLEAN | NOT NULL | true | Soft toggle |
| `notes` | TEXT | nullable | null | — |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Indexes:** `(organization_id, code)` UNIQUE for code lookup.

### RoutingTemplate

Production routing for a product element. Linked to ProductionMethod by UUID FK (cross-module within package).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `product_id` | UUID | NOT NULL | — | FK to CatalogProduct (cross-package, UUID). Which product/sub-assembly this routing is for |
<!-- production_method_id REMOVED — PM owns the FK to RoutingTemplate, not the reverse. Query PM→Routing via ProductionMethod.routing_template_id. See review finding #4. -->
| `name` | VARCHAR(255) | NOT NULL | — | Human label (e.g., "Seat assembly routing", "Cover sewing routing") |
| `is_active` | BOOLEAN | NOT NULL | true | Soft toggle |
| `version` | INTEGER | NOT NULL | 1 | Version number for change tracking |
| `notes` | TEXT | nullable | null | — |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Indexes:** `(organization_id, product_id)` for product→routing lookup.

### OperationTemplate

Single operation within a routing. ORM relation to parent RoutingTemplate and to WorkCenter (both same module).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `routing_template_id` | UUID | NOT NULL | — | FK to RoutingTemplate (ORM relation — same module) |
| `work_center_id` | UUID | nullable | null | FK to WorkCenter (ORM relation — same module). Nullable per Graceful Incompleteness |
| `sequence` | INTEGER | NOT NULL | 10 | Display ordering (10, 20, 30). Does NOT define execution order — that's OperationDependency. Used for default display and as fallback when no dependencies exist |
| `name` | VARCHAR(255) | NOT NULL | — | Operation name (e.g., "Foam lamination", "CNC cutting", "Quality check") |
| `setup_time_minutes` | NUMERIC(10,2) | nullable | null | Machine setup time before operation. Nullable — can be filled in later |
| `run_time_minutes` | NUMERIC(10,2) | nullable | null | Processing time per unit. Core time component. Nullable per Graceful Incompleteness |
| `teardown_time_minutes` | NUMERIC(10,2) | nullable | null | Cleanup time after operation. Nullable |
| `queue_time_minutes` | NUMERIC(10,2) | nullable | null | Wait time before operation (material queuing). Non-occupation time — work center is free |
| `wait_time_minutes` | NUMERIC(10,2) | nullable | null | Post-operation wait (e.g., glue drying, curing). Non-occupation time |
| `move_time_minutes` | NUMERIC(10,2) | nullable | null | Transport time to next work center |
| `payment_type` | ENUM('hourly','piecework','base_plus_piecework') | NOT NULL | 'hourly' | Labor cost calculation model |
| `piecework_rate` | NUMERIC(18,4) | nullable | null | Rate per piece (used when payment_type includes piecework) |
| `hourly_rate` | NUMERIC(18,4) | nullable | null | Rate per hour (used when payment_type includes hourly) |
| `is_subcontracted` | BOOLEAN | NOT NULL | false | Operation performed by external vendor (future subcontracting module) |
| `allow_splitting` | BOOLEAN | NOT NULL | false | Can this operation be split across multiple work centers/machines? |
| `max_splits` | INTEGER | nullable | null | Max parallel splits (null = unlimited when allow_splitting=true) |
| `setup_group` | VARCHAR(50) | nullable | null | Changeover group for future setup matrix (SetupMatrixRule). Operations in same group share setup time |
| `instructions` | TEXT | nullable | null | Quick instruction notes for operators. Short text, not full documentation |
| `notes` | TEXT | nullable | null | — |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Indexes:** `(routing_template_id, sequence)` for ordered operation listing. `(organization_id, work_center_id)` for "which operations use this work center" queries.

**Time calculation:** Work center occupation per batch = `setup_time + (run_time × quantity) + teardown_time`. Total lead time adds `queue_time + wait_time + move_time`. Efficiency adjustment: `occupation_time / (efficiency_percent / 100)`.

### OperationTemplateVariant

Per-variant override on an operation. Overrides time, rate, or work center for specific variants/configurations. Same XOR pattern as BomLineVariant (sub-spec b).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `operation_template_id` | UUID | NOT NULL | — | FK to OperationTemplate (ORM relation — same module) |
| `variant_id` | UUID | nullable | null | FK to CatalogProductVariant (cross-package, UUID). For variant_based products. **XOR with variant_condition** |
| `variant_condition` | JSONB | nullable | null | For rule_based products. Same format as BomLine.variant_condition. **XOR with variant_id** |
| `run_time_override` | NUMERIC(10,2) | nullable | null | Override run_time_minutes. Null = inherit from base |
| `setup_time_override` | NUMERIC(10,2) | nullable | null | Override setup_time_minutes. Null = inherit |
| `teardown_time_override` | NUMERIC(10,2) | nullable | null | Override teardown_time_minutes. Null = inherit |
| `work_center_override_id` | UUID | nullable | null | FK to WorkCenter. Override work center for this variant. Null = inherit |
| `piecework_rate_override` | NUMERIC(18,4) | nullable | null | Override piecework rate. Null = inherit |
| `hourly_rate_override` | NUMERIC(18,4) | nullable | null | Override hourly rate. Null = inherit |
| `notes` | TEXT | nullable | null | — |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete |

**Constraints:**
- DB CHECK: `(variant_id IS NOT NULL AND variant_condition IS NULL) OR (variant_id IS NULL AND variant_condition IS NOT NULL)` — XOR enforcement
- Application-enforced (Zod): same XOR + variant_condition key validation

**Indexes:** `(operation_template_id, variant_id)` for variant_based lookup.

### OperationDependency

Directed edge in the operation DAG. Defines execution order constraints between operations.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | PK |
| `organization_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `tenant_id` | VARCHAR | NOT NULL | — | Tenant scoping |
| `predecessor_operation_id` | UUID | NOT NULL | — | FK to OperationTemplate (ORM relation). Operation that must happen first |
| `successor_operation_id` | UUID | NOT NULL | — | FK to OperationTemplate (ORM relation). Operation that depends on predecessor |
| `dependency_type` | ENUM('finish_to_start','start_to_start','finish_to_finish') | NOT NULL | 'finish_to_start' | When can successor begin relative to predecessor |
| `link_strength` | ENUM('required','optional') | NOT NULL | 'required' | Required = scheduler must respect. Optional = scheduler may overlap if it helps meet deadline |
| `overlap_quantity` | INTEGER | nullable | null | Successor can start after N units from predecessor are done (pipeline). Mutually exclusive with overlap_time |
| `overlap_time_minutes` | NUMERIC(10,2) | nullable | null | Successor can start N minutes after predecessor starts. Mutually exclusive with overlap_quantity |
| `created_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL | now() | — |
| `deleted_at` | TIMESTAMPTZ | nullable | null | Soft delete (per OM convention — every command must be undoable) |

**Constraints:**
- Application-enforced (Zod): predecessor and successor must belong to the same RoutingTemplate
- DB CHECK + Zod `.refine()`: overlap_quantity and overlap_time_minutes are mutually exclusive — `CHECK (NOT (overlap_quantity IS NOT NULL AND overlap_time_minutes IS NOT NULL))`

**Indexes:** `(predecessor_operation_id)` and `(successor_operation_id)` for graph traversal. `(organization_id, predecessor_operation_id, successor_operation_id)` UNIQUE to prevent duplicate edges.

## DAG Validation Algorithm

Lives in `lib/dependency-graph.ts` as a pure function. Runs on routing save (synchronous — graph is small enough).

### Validations

1. **Cycle detection**: topological sort of operations via active dependencies (exclude soft-deleted). If sort fails (cycle found), return error listing the cycle path
2. **Both operations in same routing**: predecessor_operation_id and successor_operation_id must reference operations in the same RoutingTemplate
3. **No self-reference**: predecessor ≠ successor
4. **Duplicate edge prevention**: UNIQUE constraint on (predecessor, successor)

### Non-Validations (by design)

- **Disconnected operations are allowed**: an operation with no dependencies is valid (Graceful Incompleteness — dependencies can be added later)
- **Multiple terminal operations are allowed**: routing may have several end points (e.g., parallel packaging stations)
- **No mandatory start/end nodes**: the graph is structurally valid as long as it's acyclic

### API

- `POST /api/manufacturing/routing/validate-graph` — accepts `routingTemplateId`, returns `{ valid: boolean, errors: string[], topology: string[] }` (ordered operation IDs if valid, error descriptions if not)

## Time Rollup Algorithm

Lives in `lib/time-rollup.ts` as a pure function.

### Input
```typescript
type TimeRollupInput = {
  operations: Array<{
    id: string
    setupTime: number | null
    runTime: number | null
    teardownTime: number | null
    queueTime: number | null
    waitTime: number | null
    moveTime: number | null
    workCenterEfficiency: number  // percentage
  }>
  quantity: number
  variantOverrides?: Map<string, Partial<{
    runTime: number
    setupTime: number
    teardownTime: number
  }>>
}
```

### Calculation
Per operation:
- Apply variant override if present (replace base time with override)
- Occupation time = `setup + (run × quantity) + teardown`
- Adjusted occupation = `occupation / (efficiency / 100)`
- Total time = `adjusted_occupation + queue + wait + move`

Rollup = sum of all operation total times (for sequential). For parallel paths (operations without dependencies between them), total = max of parallel branches. Requires dependency graph to compute correctly.

### Output
```typescript
type TimeRollupResult = {
  totalOccupationMinutes: number    // sum of all occupation times
  totalLeadTimeMinutes: number      // critical path through DAG
  perOperation: Array<{
    operationId: string
    occupationMinutes: number
    leadTimeMinutes: number
  }>
  warnings: string[]                // e.g., "Operation X has null run_time — treated as 0"
}
```

## API Contracts

All routes under `/api/manufacturing/`. CRUD routes use `makeCrudRoute` with `openApi` export. All entity queries use `findWithDecryption`/`findOneWithDecryption` per OM convention.

**Route prefix convention:** Route files nested under `api/manufacturing/` to achieve `/api/manufacturing/` prefix (e.g., `api/manufacturing/routing/route.ts` → `/api/manufacturing/routing`). See sub-spec a for rationale.

### Work Center
- `GET /api/manufacturing/work-center` — List (filtered by factory_zone_id, is_active, scheduling_mode)
- `GET /api/manufacturing/work-center/:id` — Detail
- `POST /api/manufacturing/work-center` — Create
- `PUT /api/manufacturing/work-center/:id` — Update
- `DELETE /api/manufacturing/work-center/:id` — Soft delete

### Factory Zone
- `GET /api/manufacturing/factory-zone` — List
- `GET /api/manufacturing/factory-zone/:id` — Detail
- `POST /api/manufacturing/factory-zone` — Create
- `PUT /api/manufacturing/factory-zone/:id` — Update
- `DELETE /api/manufacturing/factory-zone/:id` — Soft delete

### Routing Template
- `GET /api/manufacturing/routing` — List (filtered by product_id, is_active)
- `GET /api/manufacturing/routing/:id` — Detail (includes nested operations and dependencies)
- `POST /api/manufacturing/routing` — Create
- `PUT /api/manufacturing/routing/:id` — Update
- `DELETE /api/manufacturing/routing/:id` — Soft delete

### Operation Template
- `GET /api/manufacturing/operation` — List (filtered by routing_template_id, work_center_id)
- `GET /api/manufacturing/operation/:id` — Detail
- `POST /api/manufacturing/operation` — Create
- `PUT /api/manufacturing/operation/:id` — Update
- `DELETE /api/manufacturing/operation/:id` — Soft delete

### Operation Template Variant
- `GET /api/manufacturing/operation-variant` — List (filtered by operation_template_id)
- `GET /api/manufacturing/operation-variant/:id` — Detail
- `POST /api/manufacturing/operation-variant` — Create
- `PUT /api/manufacturing/operation-variant/:id` — Update
- `DELETE /api/manufacturing/operation-variant/:id` — Soft delete

### Operation Dependency
- `GET /api/manufacturing/operation-dependency` — List (filtered by routing_template_id via operation FK)
- `POST /api/manufacturing/operation-dependency` — Create (triggers DAG validation)
- `PUT /api/manufacturing/operation-dependency/:id` — Update (triggers DAG validation)
- `DELETE /api/manufacturing/operation-dependency/:id` — Soft delete

### Custom Endpoints
- `POST /api/manufacturing/routing/validate-graph` — DAG validation (see algorithm above)
- `POST /api/manufacturing/routing/time-rollup` — Time rollup calculation
  - Request: `{ routingTemplateId: string, quantity: number, variantConditions?: Record<string, string[]> }`
  - Response: `TimeRollupResult`

## Commands & Events

### Commands

| Command | Entity | Undo |
|---|---|---|
| `routing.work_center.create` | WorkCenter | Delete created record |
| `routing.work_center.update` | WorkCenter | Restore previous field values |
| `routing.work_center.delete` | WorkCenter | Restore soft-deleted record |
| `routing.factory_zone.create` | FactoryZone | Delete created record |
| `routing.factory_zone.update` | FactoryZone | Restore previous field values |
| `routing.factory_zone.delete` | FactoryZone | Restore soft-deleted record |
| `routing.routing_template.create` | RoutingTemplate | Delete created record |
| `routing.routing_template.update` | RoutingTemplate | Restore previous field values |
| `routing.routing_template.delete` | RoutingTemplate | Restore soft-deleted record |
| `routing.operation_template.create` | OperationTemplate | Delete created record |
| `routing.operation_template.update` | OperationTemplate | Restore previous field values |
| `routing.operation_template.delete` | OperationTemplate | Restore soft-deleted record |
| `routing.operation_template_variant.create` | OperationTemplateVariant | Delete created record |
| `routing.operation_template_variant.update` | OperationTemplateVariant | Restore previous field values |
| `routing.operation_template_variant.delete` | OperationTemplateVariant | Restore soft-deleted record |
| `routing.operation_dependency.create` | OperationDependency | Delete created record |
| `routing.operation_dependency.update` | OperationDependency | Restore previous field values |
| `routing.operation_dependency.delete` | OperationDependency | Restore soft-deleted record |

### Events

```typescript
const events = [
  { id: 'routing.routing_template.created', label: 'Routing Created', entity: 'routing_template', category: 'crud' },
  { id: 'routing.routing_template.updated', label: 'Routing Updated', entity: 'routing_template', category: 'crud' },
  { id: 'routing.routing_template.deleted', label: 'Routing Deleted', entity: 'routing_template', category: 'crud' },
  { id: 'routing.operation_template.created', label: 'Operation Created', entity: 'operation_template', category: 'crud' },
  { id: 'routing.operation_template.updated', label: 'Operation Updated', entity: 'operation_template', category: 'crud' },
  { id: 'routing.operation_template.deleted', label: 'Operation Deleted', entity: 'operation_template', category: 'crud' },
  { id: 'routing.work_center.created', label: 'Work Center Created', entity: 'work_center', category: 'crud' },
  { id: 'routing.work_center.updated', label: 'Work Center Updated', entity: 'work_center', category: 'crud' },
  { id: 'routing.work_center.deleted', label: 'Work Center Deleted', entity: 'work_center', category: 'crud' },
  { id: 'routing.factory_zone.created', label: 'Factory Zone Created', entity: 'factory_zone', category: 'crud' },
  { id: 'routing.factory_zone.updated', label: 'Factory Zone Updated', entity: 'factory_zone', category: 'crud' },
  { id: 'routing.factory_zone.deleted', label: 'Factory Zone Deleted', entity: 'factory_zone', category: 'crud' },
  { id: 'routing.operation_template_variant.created', label: 'Operation Variant Created', entity: 'operation_template_variant', category: 'crud' },
  { id: 'routing.operation_template_variant.updated', label: 'Operation Variant Updated', entity: 'operation_template_variant', category: 'crud' },
  { id: 'routing.operation_template_variant.deleted', label: 'Operation Variant Deleted', entity: 'operation_template_variant', category: 'crud' },
  { id: 'routing.operation_dependency.created', label: 'Dependency Created', entity: 'operation_dependency', category: 'crud' },
  { id: 'routing.operation_dependency.updated', label: 'Dependency Updated', entity: 'operation_dependency', category: 'crud' },
  { id: 'routing.operation_dependency.deleted', label: 'Dependency Deleted', entity: 'operation_dependency', category: 'crud' },
] as const
```

## ACL Features

```typescript
export const features = [
  { id: 'routing.view', title: 'View production routings', module: 'routing' },
  { id: 'routing.create', title: 'Create production routings', module: 'routing' },
  { id: 'routing.update', title: 'Update production routings', module: 'routing' },
  { id: 'routing.delete', title: 'Delete production routings', module: 'routing' },
  { id: 'routing.work_center.view', title: 'View work centers', module: 'routing' },
  { id: 'routing.work_center.manage', title: 'Manage work centers', module: 'routing' },
]
```

Default role features:
```typescript
defaultRoleFeatures: {
  admin: ['routing.*'],
  employee: ['routing.view', 'routing.work_center.view'],
}
```

## Implementation Plan

### Phase A: Work Centers + Entities

1. Create `src/modules/routing/` with: `index.ts`, `acl.ts`, `events.ts`, `setup.ts`, `di.ts`, `search.ts`, `translations.ts`
2. Create `data/entities.ts` with all 6 entities (ORM relations within module)
3. Create `data/validators.ts` with Zod schemas (including XOR on OperationTemplateVariant, overlap mutual exclusivity on OperationDependency)
4. Create `translations.ts` declaring translatable fields: WorkCenter.name, FactoryZone.name, RoutingTemplate.name, OperationTemplate.name
5. Create `search.ts` with searchConfig for WorkCenter (by name, code), RoutingTemplate (by name, product)
6. Hand-write migrations: create tables in FK dependency order (FactoryZone → WorkCenter → RoutingTemplate → OperationTemplate → OperationTemplateVariant → OperationDependency). Include CHECK constraints (XOR on variant, overlap exclusivity). Known db:generate bug for external packages — follow migration playbook
7. Create CRUD routes for all 6 entities. All queries use `findWithDecryption`. All mutations use `validateCrudMutationGuard`
8. OperationDependency create/update triggers same-routing validation (both operations must be in same RoutingTemplate). Use `withAtomicFlush` for validation queries

**Testable outcome:** Full CRUD on all 6 entities. OperationDependency validates same-routing constraint.

### Phase B: DAG Validation + Time Rollup

1. Create `lib/dependency-graph.ts` — pure DAG validation function (cycle detection via topological sort)
2. Create `lib/time-rollup.ts` — pure time calculation function (per operation + critical path)
3. Create `api/routing/validate-graph.ts` — validation endpoint
4. Create `api/routing/time-rollup.ts` — time rollup endpoint
5. Wire DAG validation into OperationDependency create/update (reject if cycle introduced)
6. Apply variant overrides in time rollup (OperationTemplateVariant)

**Testable outcome:** DAG validation detects cycles and reports topology. Time rollup computes correct times with efficiency adjustment and variant overrides.

### Phase C: UI Widget + Tests

**Depends on:**
- `2026-04-05-manufacturing-ui-foundation.md` Phase 3 (tab shell, `ManufacturingTabsLayout`, detail page)
- `2026-04-05-manufacturing-ui-foundation.md` Phase 2 (WorkCenter master data page — operations pick work centers from here)
- Sub-spec d Phase C (`useConfigAttributeKeys` hook — used for OperationTemplateVariant variant_condition validation)

#### 1. RoutingTab component

- **Location**: `packages/manufacturing/src/modules/routing/components/RoutingTab.tsx` (exported and consumed by the product detail page from `2026-04-05-manufacturing-ui-foundation.md`)
- **Props**: `{ productId: string; extension: ProductManufacturingExtension }`
- **ACL feature**: `routing.view` for reads, `routing.create`/`routing.update`/`routing.delete` for writes

Empty state when the product has no RoutingTemplate: "No routing defined. Create routing →" with primary button that opens the RoutingTemplate create dialog.

#### 2. Routing selector

If the product has multiple RoutingTemplates (via multiple PMs), show a dropdown at the top to switch between them. Single-routing products skip the selector and render operations directly.

#### 3. Operations DataTable

`DataTable` of OperationTemplate rows for the selected routing template:

| Column | Display |
|---|---|
| Sequence | Number (from `sort_order`) |
| Name | Operation name (translatable) |
| Work center | `WorkCenter.name` + code badge, or "No work center" placeholder with warning icon |
| Setup time | Minutes or "—" |
| Run time | Minutes or "—" |
| Teardown time | Minutes or "—" |
| Payment type | Badge: `hourly` / `piecework` / `mixed` |
| Rate | Amount with currency or "—" |
| Subcontracted | Flag icon if true |

**Row actions** (stable ids): `edit`, `delete`, `reorder-up`, `reorder-down`
**Header action**: "Add Operation"

Reorder uses `sort_order` increment/decrement via API — same pattern as BOM lines (no drag-and-drop).

#### 4. Operation CRUD dialogs

**Add / Edit Operation** → `CrudForm` dialog with:

- Name (translatable text)
- Work center: searchable combobox of WorkCenter (master data from foundation Phase 2) with "Create new" shortcut → inline dialog that creates the work center without leaving the page
- Setup / run / teardown / wait / move time (all numeric, nullable per Graceful Incompleteness — null times display as "—" and are treated as 0 in calculations)
- Payment type (select: `hourly` / `piecework` / `mixed`)
- Hourly rate (number, shown when payment_type ∈ {hourly, mixed})
- Piece rate (number, shown when payment_type ∈ {piecework, mixed})
- Subcontracted (toggle)
- Factory zone (combobox of FactoryZone, optional)
- `sort_order` (auto-assigned, editable)

Save always succeeds — null work center or null times produce warning icons on the row, not save errors.

#### 5. OperationTemplateVariant inline section

Expand arrow on any operation row reveals nested variant override rows. Each override shows:

- Variant identifier (CatalogProductVariant name or raw `variant_condition` keys)
- Time overrides (setup / run / teardown — any subset)
- Rate overrides (hourly / piece — any subset)
- Work center override (or "—")

**Inline actions**: add override (dialog), edit (dialog), delete (confirm). Dialog enforces the XOR constraint — exactly one of `catalog_product_variant_id` or `variant_condition` must be set. `variant_condition` keys validated against `useConfigAttributeKeys(productId)` from sub-spec d — unknown keys produce a warning badge (non-blocking).

#### 6. Dependency section

Two views side by side: a read-only flow visualization and a CRUD list for editing.

##### Flow visualization (read-only)

Uses the topological sort from `lib/dependency-graph.ts` to render operations grouped by execution level (operations with no unresolved predecessors = level 0, their successors = level 1, etc.). Parallel operations at the same level shown side by side. Connector lines/arrows show convergence points.

Example render:

```
┌─ Foam lamination (WC-FOAM, 45 min)
├─ Cover sewing (WC-SEW, 60 min)
├─ Frame assembly (WC-FRAME, 30 min)
├─ Side panel gluing (WC-SIDE, 25 min)
└─→ Upholstery (WC-UPHO, 90 min)
     └─→ Quality check (WC-QC, 15 min)
          └─→ Packaging (WC-PACK, 45 min)
```

Rendered with plain HTML/CSS (indented divs with connector lines). Each node shows: operation name, work center code, run time. Parallel paths visually grouped at the same indentation level. Convergence points marked with arrow connectors from all predecessors. Operations without dependencies shown at level 0 with a note "No dependencies — follows sequence order."

**No graph library in this phase.** Future: replace with an interactive editor (React Flow or equivalent) where users can drag to create/remove dependencies visually.

##### Dependency list (CRUD)

Below the flow visualization, a simple list:

```
Dependencies:
• Foam lamination → Upholstery (finish-to-start, required)
• Cover sewing → Upholstery (finish-to-start, required)
• Frame assembly → Upholstery (finish-to-start, required)
```

- **Add dependency**: dialog with predecessor + successor operation selects (both scoped to the current routing) + dependency type (`finish_to_start` / `start_to_start` / `finish_to_finish` / `start_to_finish`) + strength (`required` / `preferred`)
- **Delete dependency** (confirm dialog)
- **Cycle detection**: if adding a dependency would create a cycle, the dialog blocks save and displays the cycle path (e.g., "Circular reference: A → B → A"). Server-side validation also runs via the existing `lib/dependency-graph.ts` on every dependency write
- **`preferred` strength behavior**: both `required` and `preferred` dependencies render identically in the flow visualization (same arrows) and are treated identically in time rollup (both count for critical path). The distinction is metadata for future scheduling — `preferred` indicates a soft constraint that a scheduler may relax under capacity pressure. For the current UI phase, the only visual difference is a "(preferred)" label on the dependency row in the CRUD list. No scheduling engine exists yet to exploit the distinction

#### 7. Time rollup panel

Collapsible section at the bottom of the tab:

- "Calculate Time" button
- Quantity input (default: 1)
- **Configuration input switching** — same pattern as BOM explosion panel (sub-spec b §6):

| `configuration_type` | Input Component | Output passed to time rollup |
|---|---|---|
| `none` | Nothing — just button + quantity | `{}` — base times used for all operations |
| `variant_based` | `VariantPicker` (from `product_master/components/VariantPicker.tsx`, shared with sub-spec b) | `{ catalogProductVariantId }` — matches OperationTemplateVariant.catalog_product_variant_id for time overrides |
| `rule_based` | `ConfigurationForm` (from sub-spec d §3) | `{ variantConditions }` — matches OperationTemplateVariant.variant_condition for time overrides |

- **Result display**:
  - Total occupation time (sum of all operations)
  - Total lead time (critical path through the DAG)
  - Per-operation breakdown (table: operation, duration, start level, end level)
  - **Warnings panel** (collapsible): operations with null run_time, operations without work centers, disconnected operations, etc.

#### 8. Readiness checklist integration

Expose `useIsRoutingReady(productId): boolean` — returns `true` when at least one RoutingTemplate with at least one non-soft-deleted OperationTemplate exists for the product. Foundation overview tab calls this to flip routing ○ → ✓.

Also expose `useRoutingName(productId): { name: string | null; ready: boolean }` for the production method cards on the overview tab to display linked routing names.

#### 9. Unit tests

Already completed as part of Phase B algorithm work (`lib/dependency-graph.ts` — 10 tests, `lib/time-rollup.ts` — 8 tests, validators — 13 tests). No additional unit tests required for the UI layer.

#### 10. Integration tests

Tests in `packages/manufacturing/src/modules/routing/__integration__/routing-tab.spec.ts`. Playwright, API-first setup + UI navigation.

| ID | Scenario | Validates |
|---|---|---|
| C-UI-1 | Open product detail with no routing → verify Routing tab shows "No routing defined" empty state → click "Create routing" → create RoutingTemplate → verify empty operations table renders | Empty state, RoutingTemplate create |
| C-UI-2 | Open Add Operation dialog → create operation with work center from combobox → verify row appears in table with work center badge | Routing CRUD, work center picker from master data |
| C-UI-3 | Create operation with null run_time → verify "—" display in run time column with tooltip "Time not set" → save succeeds | Graceful Incompleteness — null times |
| C-UI-4 | Open Add Operation dialog → click "Create new work center" shortcut → verify inline dialog creates work center → verify new work center selected in outer dialog | Cross-page master data shortcut, dialog stacking |
| C-UI-5 | Add 4 operations → add dependencies forming parallel→converging graph (3 → 1 → 2) → verify flow visualization renders parallel paths and convergence arrows | Flow visualization, topological sort rendering |
| C-UI-6 | Add dependency A→B and B→C, then attempt to add C→A → verify dialog blocks save with cycle error showing the cycle path | Cycle detection in UI dialog |
| C-UI-7 | Click "Calculate Time" on a routing with 3 operations (one with null run_time) → verify result shows total time, critical path, per-operation breakdown, and warning about null run_time | Time rollup with incomplete data |
| C-UI-8 | Create OperationTemplateVariant with `variant_condition` key not in ConfigAttributes → verify warning badge on row → save succeeds | Namespace validation (advisory), OperationTemplateVariant CRUD |
| C-UI-9 | Soft-delete a referenced work center → reload routing tab → verify affected operations show "work center deleted" indicator but still render | Soft-delete cascading visibility |

#### 11. End-to-end cross-module test (owned by this sub-spec)

Because routing is recommended as the last tab to implement, this sub-spec owns the full vertical slice integration test that exercises the whole product foundation UI stack:

| ID | Scenario | Validates |
|---|---|---|
| C-E2E-1 | Create catalog product → enable manufacturing → set `configuration_type='rule_based'` → create 3 ConfigAttributes (sub-spec d UI) → create BomHeader with 3 BomLines including one with `variant_condition` (sub-spec b UI) → create RoutingTemplate with 3 operations and 2 dependencies (this sub-spec UI) → create ProductionMethod linking the BOM and routing → return to Overview tab → verify readiness checklist shows all ✓ → verify production method card shows linked BOM and routing names with clickable links that switch tabs | End-to-end vertical slice across foundation + sub-specs b/c/d, readiness checklist propagation, PM card wiring |

**Testable outcome:** Routing tab visible in product detail. Add operations with work center selection. See flow visualization. Define dependencies with cycle protection. Calculate time rollup. Overview tab reflects routing readiness. Full cross-module E2E test passes. All unit and integration tests pass.

## Risks & Impact Review

#### DAG Validation on Concurrent Edits
- **Scenario**: Two users simultaneously add dependencies that together create a cycle (A→B and B→A). Each passes validation individually
- **Severity**: Low
- **Affected area**: Data integrity of operation dependency graph
- **Mitigation**: The shared pure `validateDag` is exposed via `/api/manufacturing/routing/validate-graph` and run by the UI before dependency writes (see §Dependency list §CRUD). Any invalid graph is detected on the next dependency save or time-rollup request and surfaced as a warning. See also *Client-only DAG Enforcement* below for the server-side gap this mitigation currently depends on
- **Residual risk**: Brief window of invalid graph during concurrent writes. Acceptable — no downstream consumer yet (scheduling module not implemented)

#### Client-only DAG Enforcement
- **Scenario**: `routing.operation_dependency.create` command validates same-routing but does NOT run `validateDag` before insert. The UI pre-checks via the shared pure validator, so the authoring path is protected; a caller hitting the POST endpoint directly (scripted client, partner integration, test harness that skips the UI dialog) can insert an edge that forms a cycle
- **Severity**: Medium
- **Affected area**: Data integrity of operation dependency graph
- **Mitigation**: Add a `validateDag` call inside the `routing.operation_dependency.create` command (and the update command, which doesn't change predecessor/successor today but could) before `em.persist`. Reject with `CrudHttpError(400)` and the cycle path if invalid. Tracked as a server-hardening follow-up — the UI pre-check in `OperationDependencyDialog` already blocks the authoring path, so a separate small PR can close the loop without blocking Phase C. The `/validate-graph` endpoint already runs the same logic and can be used as the source of truth in the command handler
- **Residual risk**: Until landed, cycles can be introduced by bypassing the UI. No data corruption (the graph stays tenant-scoped and soft-delete recoverable) but downstream consumers (time rollup, future scheduler) must remain tolerant of invalid graphs rather than assuming server-side enforcement

#### WorkCenter Deletion With Referenced Operations
- **Scenario**: User deletes a WorkCenter that has OperationTemplates referencing it
- **Severity**: Medium
- **Affected area**: Routing integrity
- **Mitigation**: Soft delete only. OperationTemplate.work_center_id remains pointing to soft-deleted WorkCenter. UI shows "work center deleted" indicator. Operations continue to function with null-like display. Graceful Incompleteness — work center can be reassigned later
- **Residual risk**: Orphaned references until reassigned. Acceptable — same pattern as OM's soft delete on catalog products

#### Incomplete Routing Data
- **Scenario**: Routing exists with operations that have null run_time, null work_center, no dependencies. User requests time rollup
- **Severity**: Low
- **Affected area**: Time rollup accuracy
- **Mitigation**: Per Graceful Incompleteness. Null times = 0 in calculations. Null work_center = efficiency defaults to 100%. No dependencies = operations assumed sequential by sequence number. Result includes warnings for incomplete data
- **Residual risk**: None — partial results are the intended behavior

## Final Compliance Report — 2026-04-04

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | ORM relations within routing module only. Cross-module refs (product_id, shift_calendar_id) use UUID strings. PM→Routing link owned by ProductionMethod, not RoutingTemplate |
| root AGENTS.md | Filter by organization_id | Compliant | All entities have organization_id + tenant_id |
| root AGENTS.md | Validate inputs with Zod | Compliant | data/validators.ts with XOR on OperationTemplateVariant, overlap exclusivity on dependency |
| root AGENTS.md | API routes MUST export openApi | Compliant | Via makeCrudRoute + custom endpoints with explicit openApi |
| root AGENTS.md | Write operations via Command pattern | Compliant | 17 commands with undo contracts |
| root AGENTS.md | Event IDs: module.entity.action (singular) | Compliant | routing.routing_template.created, routing.work_center.updated, etc. Module name as prefix per OM convention |
| root AGENTS.md | DB schema ADDITIVE-ONLY | Compliant | All new tables |
| root AGENTS.md | ACL feature IDs FROZEN once created | Compliant | New features (routing.*) |
| packages/core AGENTS.md | setup.ts: declare defaultRoleFeatures | Compliant | admin: routing.*, employee: view |
| packages/core AGENTS.md | Translatable fields in translations.ts | Compliant | WorkCenter.name, FactoryZone.name, RoutingTemplate.name, OperationTemplate.name |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | 6 CRUD resources + 2 custom endpoints match 6 entities + 2 algorithms |
| API contracts match UI/UX section | Pass | Routing tab + graph visualization consume CRUD + validation + rollup APIs |
| Risks cover all write operations | Pass | CRUD, DAG validation, concurrent edits, soft delete cascading |
| Commands defined for all mutations | Pass | 17 commands with standard undo (all soft-delete) |
| Cache strategy covers all read APIs | N/A | No caching needed — standard CRUD |

### Verdict

**Fully compliant** — ready for implementation.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — Work Centers + Entities | Done | 2026-04-04 | 6 entities, 17 commands, 6 CRUD routes, migration |
| Phase B — DAG Validation + Time Rollup | Done | 2026-04-04 | Pure DAG validation (Kahn's algo), time rollup with critical path, 2 custom endpoints |
| Phase C — Widget + Tests | In Progress | 2026-04-04 | Algorithm + unit tests done (31 tests). RoutingTab placeholder landed in foundation spec Phase 3. Detailed RoutingTab UI + E2E cross-module test migrated into this spec (2026-04-11 refactor) — implementation not started |
| Review fixes | Done | 2026-04-06 | Removed production_method_id from RoutingTemplate entity/validator/command/route. Added 9 missing CRUD events. Migration regenerated |

---

## Changelog

### 2026-04-20
- **Risks**: Added *Client-only DAG Enforcement* entry documenting that `routing.operation_dependency.create` validates same-routing only, not cycle-freeness. The UI pre-checks via `validateDag` (see `OperationDependencyDialog`) so the authoring path is protected; direct POST callers bypass that. Tracked as a server-hardening follow-up. Also tightened the mitigation copy on the neighbouring *DAG Validation on Concurrent Edits* risk — removed the incorrect claim that "DAG validation runs on every dependency save" and redirected to the new risk.

### 2026-04-17
- **Removed `Market Reference` blockquote** from §Proposed Solution (DAG / time components / payment types / WorkCenter attributions against 13 reference systems). The comparative-research framing is not consistent with the rest of OM's spec style. Where a pattern attribution is genuinely load-bearing for a design decision, it can live in the Rationale column of the Design Decisions table; nothing in this spec required that.

### 2026-04-11
- **Phase C expansion**: Migrated detailed Routing tab UI spec from `2026-04-05-manufacturing-ui-foundation.md` (foundation UI spec refactor). Added RoutingTab component contract, operations DataTable layout, Operation CRUD dialogs, OperationTemplateVariant inline section, flow visualization + dependency list CRUD with cycle detection, time rollup panel, readiness hook exports (`useIsRoutingReady`, `useRoutingName`), 9 integration tests (C-UI-1..9), and 1 cross-module end-to-end test (C-E2E-1) owned by this sub-spec. Phase C status: Done (placeholder only) → In Progress. Declared dependencies on foundation Phase 3 + Phase 2 (WorkCenter) + sub-spec d Phase C.

### 2026-04-06
- Review fixes: removed production_method_id from RoutingTemplate (FK direction reversal — PM owns routing_template_id). Added factory_zone, operation_template_variant, operation_dependency CRUD events. Status → In Progress

### 2026-04-05
- OperationDependency changed from hard-delete to soft-delete with standard undo. OM convention requires every command to be undoable. DAG validation updated to exclude soft-deleted dependencies

### 2026-04-04
- Pre-implementation analysis fixes: added warnings to TimeRollupResult, overlap CHECK constraint on OperationDependency, hand-write migration with FK dependency order in Phase A, validateCrudMutationGuard + withAtomicFlush in Phase A
- Applied fixes from sub-spec b review: API route prefix note, findWithDecryption notes
- Initial sub-spec. 6 entities (WorkCenter, FactoryZone, RoutingTemplate, OperationTemplate, OperationTemplateVariant, OperationDependency). DAG validation + time rollup algorithms. 3-phase implementation plan. Follows patterns from sub-specs a and b
