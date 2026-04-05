import { Migration } from '@mikro-orm/migrations';

/**
 * Initial migration for manufacturing routing module.
 *
 * 6 tables in FK dependency order: FactoryZone → WorkCenter → RoutingTemplate →
 * OperationTemplate → OperationTemplateVariant → OperationDependency.
 * SQL curated from db:generate output (known platform bug for external packages).
 */
export class Migration20260404000003 extends Migration {

  override async up(): Promise<void> {
    // 1. FactoryZone (no FKs)
    this.addSql(`create table "manufacturing_factory_zones" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" varchar(255) not null, "code" varchar(50) not null, "location_id" uuid null, "is_active" boolean not null default true, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_factory_zones_pkey" primary key ("id"));`);
    this.addSql(`alter table "manufacturing_factory_zones" add constraint "manufacturing_fz_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);

    // 2. WorkCenter (FK to FactoryZone)
    this.addSql(`create table "manufacturing_work_centers" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" varchar(255) not null, "code" varchar(50) not null, "factory_zone_id" uuid null, "capacity" int not null default 1, "efficiency_percent" int not null default 100, "scheduling_mode" text not null default 'infinite', "shift_calendar_id" uuid null, "default_hourly_rate" numeric(18,4) null, "overhead_rate_per_hour" numeric(18,4) null, "is_active" boolean not null default true, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_work_centers_pkey" primary key ("id"));`);
    this.addSql(`alter table "manufacturing_work_centers" add constraint "manufacturing_wc_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "manufacturing_wc_org_zone_idx" on "manufacturing_work_centers" ("organization_id", "factory_zone_id");`);

    // 3. RoutingTemplate (no in-module FKs)
    this.addSql(`create table "manufacturing_routing_templates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "production_method_id" uuid null, "name" varchar(255) not null, "is_active" boolean not null default true, "version" int not null default 1, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_routing_templates_pkey" primary key ("id"));`);
    this.addSql(`create index "manufacturing_rt_org_product_idx" on "manufacturing_routing_templates" ("organization_id", "product_id");`);
    this.addSql(`create index "manufacturing_rt_org_pm_idx" on "manufacturing_routing_templates" ("organization_id", "production_method_id");`);

    // 4. OperationTemplate (FK to RoutingTemplate + WorkCenter)
    this.addSql(`create table "manufacturing_operation_templates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "routing_template_id" uuid not null, "work_center_id" uuid null, "sequence" int not null default 10, "name" varchar(255) not null, "setup_time_minutes" numeric(10,2) null, "run_time_minutes" numeric(10,2) null, "teardown_time_minutes" numeric(10,2) null, "queue_time_minutes" numeric(10,2) null, "wait_time_minutes" numeric(10,2) null, "move_time_minutes" numeric(10,2) null, "payment_type" text not null default 'hourly', "piecework_rate" numeric(18,4) null, "hourly_rate" numeric(18,4) null, "is_subcontracted" boolean not null default false, "allow_splitting" boolean not null default false, "max_splits" int null, "setup_group" varchar(50) null, "instructions" text null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_operation_templates_pkey" primary key ("id"));`);
    this.addSql(`create index "manufacturing_ot_routing_seq_idx" on "manufacturing_operation_templates" ("routing_template_id", "sequence");`);
    this.addSql(`create index "manufacturing_ot_org_wc_idx" on "manufacturing_operation_templates" ("organization_id", "work_center_id");`);

    // 5. OperationTemplateVariant (FK to OperationTemplate)
    this.addSql(`create table "manufacturing_operation_template_variants" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "operation_template_id" uuid not null, "variant_id" uuid null, "variant_condition" jsonb null, "run_time_override" numeric(10,2) null, "setup_time_override" numeric(10,2) null, "teardown_time_override" numeric(10,2) null, "work_center_override_id" uuid null, "piecework_rate_override" numeric(18,4) null, "hourly_rate_override" numeric(18,4) null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_operation_template_variants_pkey" primary key ("id"));`);
    this.addSql(`create index "manufacturing_otv_op_variant_idx" on "manufacturing_operation_template_variants" ("operation_template_id", "variant_id");`);
    this.addSql(`alter table "manufacturing_operation_template_variants" add constraint "manufacturing_otv_variant_xor" check (("variant_id" IS NOT NULL AND "variant_condition" IS NULL) OR ("variant_id" IS NULL AND "variant_condition" IS NOT NULL));`);

    // 6. OperationDependency (FK to OperationTemplate × 2, no deleted_at)
    this.addSql(`create table "manufacturing_operation_dependencies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "predecessor_operation_id" uuid not null, "successor_operation_id" uuid not null, "dependency_type" text not null default 'finish_to_start', "link_strength" text not null default 'required', "overlap_quantity" int null, "overlap_time_minutes" numeric(10,2) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "manufacturing_operation_dependencies_pkey" primary key ("id"));`);
    this.addSql(`alter table "manufacturing_operation_dependencies" add constraint "manufacturing_od_pred_succ_unique" unique ("organization_id", "predecessor_operation_id", "successor_operation_id");`);
    this.addSql(`create index "manufacturing_od_pred_idx" on "manufacturing_operation_dependencies" ("predecessor_operation_id");`);
    this.addSql(`create index "manufacturing_od_succ_idx" on "manufacturing_operation_dependencies" ("successor_operation_id");`);
    this.addSql(`alter table "manufacturing_operation_dependencies" add constraint "manufacturing_od_overlap_xor" check (NOT ("overlap_quantity" IS NOT NULL AND "overlap_time_minutes" IS NOT NULL));`);

    // Foreign keys (within module)
    this.addSql(`alter table "manufacturing_work_centers" add constraint "manufacturing_work_centers_factory_zone_id_foreign" foreign key ("factory_zone_id") references "manufacturing_factory_zones" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "manufacturing_operation_templates" add constraint "manufacturing_operation_templates_routing_template_id_foreign" foreign key ("routing_template_id") references "manufacturing_routing_templates" ("id") on update cascade;`);
    this.addSql(`alter table "manufacturing_operation_templates" add constraint "manufacturing_operation_templates_work_center_id_foreign" foreign key ("work_center_id") references "manufacturing_work_centers" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "manufacturing_operation_template_variants" add constraint "manufacturing_otv_operation_template_id_foreign" foreign key ("operation_template_id") references "manufacturing_operation_templates" ("id") on update cascade;`);
    this.addSql(`alter table "manufacturing_operation_dependencies" add constraint "manufacturing_od_predecessor_foreign" foreign key ("predecessor_operation_id") references "manufacturing_operation_templates" ("id") on update cascade;`);
    this.addSql(`alter table "manufacturing_operation_dependencies" add constraint "manufacturing_od_successor_foreign" foreign key ("successor_operation_id") references "manufacturing_operation_templates" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "manufacturing_operation_dependencies" cascade;`);
    this.addSql(`drop table if exists "manufacturing_operation_template_variants" cascade;`);
    this.addSql(`drop table if exists "manufacturing_operation_templates" cascade;`);
    this.addSql(`drop table if exists "manufacturing_routing_templates" cascade;`);
    this.addSql(`drop table if exists "manufacturing_work_centers" cascade;`);
    this.addSql(`drop table if exists "manufacturing_factory_zones" cascade;`);
  }
}
