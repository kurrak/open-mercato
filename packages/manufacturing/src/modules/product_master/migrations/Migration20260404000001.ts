import { Migration } from '@mikro-orm/migrations';

/**
 * Initial migration for manufacturing product_master module.
 *
 * SQL extracted from `yarn db:generate` output (MikroORM decorator-driven),
 * then trimmed to only this module's 5 tables. The full db:generate produces
 * a schema diff against all DB tables (platform limitation for external packages),
 * so this migration is curated from that output.
 */
export class Migration20260404000001 extends Migration {

  override async up(): Promise<void> {
    // Tables
    this.addSql(`create table "manufacturing_units_of_measure" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" varchar(20) not null, "name" varchar(100) not null, "uom_type" text not null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_units_of_measure_pkey" primary key ("id"));`);

    this.addSql(`create table "product_manufacturing_extensions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "configuration_type" text not null default 'none', "procurement_type" text not null default 'buy', "base_uom_id" uuid not null, "is_phantom_default" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "product_manufacturing_extensions_pkey" primary key ("id"));`);

    this.addSql(`create table "manufacturing_production_methods" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "name" varchar(255) not null, "bom_header_id" uuid null, "routing_template_id" uuid null, "is_default" boolean not null default false, "variant_condition" jsonb null, "version" int not null default 1, "valid_from" timestamptz null, "valid_to" timestamptz null, "lifecycle_state" text not null default 'draft', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_production_methods_pkey" primary key ("id"));`);

    this.addSql(`create table "manufacturing_supplier_infos" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "supplier_name" varchar(255) not null, "supplier_id" uuid null, "supplier_sku" varchar(100) null, "price" numeric(18,4) null, "currency" varchar(3) null, "min_qty" numeric(18,4) null, "order_multiple" numeric(18,4) null, "lead_time_days" int null, "is_preferred" boolean not null default false, "valid_from" timestamptz null, "valid_to" timestamptz null, "variant_id" uuid null, "notes" text null, "last_purchase_price" numeric(18,4) null, "last_purchase_date" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_supplier_infos_pkey" primary key ("id"));`);

    this.addSql(`create table "manufacturing_uom_conversions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "from_uom_id" uuid not null, "to_uom_id" uuid not null, "factor" numeric(24,12) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_uom_conversions_pkey" primary key ("id"));`);

    // Indexes
    this.addSql(`create index "manufacturing_uom_org_tenant_idx" on "manufacturing_units_of_measure" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "manufacturing_units_of_measure" add constraint "manufacturing_uom_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`create index "product_mfg_ext_org_tenant_idx" on "product_manufacturing_extensions" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "product_manufacturing_extensions" add constraint "product_mfg_ext_product_unique" unique ("organization_id", "tenant_id", "product_id");`);

    this.addSql(`create index "manufacturing_pm_org_tenant_product_idx" on "manufacturing_production_methods" ("organization_id", "tenant_id", "product_id");`);
    this.addSql(`create index "manufacturing_pm_org_product_default_idx" on "manufacturing_production_methods" ("organization_id", "product_id", "is_default");`);
    this.addSql(`create index "manufacturing_pm_org_product_lifecycle_idx" on "manufacturing_production_methods" ("organization_id", "product_id", "lifecycle_state");`);

    this.addSql(`create index "manufacturing_si_org_tenant_product_idx" on "manufacturing_supplier_infos" ("organization_id", "tenant_id", "product_id");`);
    this.addSql(`create index "manufacturing_si_org_product_preferred_idx" on "manufacturing_supplier_infos" ("organization_id", "product_id", "is_preferred");`);

    this.addSql(`create index "manufacturing_uc_org_tenant_product_idx" on "manufacturing_uom_conversions" ("organization_id", "tenant_id", "product_id");`);
    this.addSql(`alter table "manufacturing_uom_conversions" add constraint "manufacturing_uc_product_from_to_unique" unique ("organization_id", "tenant_id", "product_id", "from_uom_id", "to_uom_id");`);

    // Foreign keys (within module — cross-package FKs use UUID strings, no DB constraint)
    this.addSql(`alter table "product_manufacturing_extensions" add constraint "product_manufacturing_extensions_base_uom_id_foreign" foreign key ("base_uom_id") references "manufacturing_units_of_measure" ("id") on update cascade;`);
    this.addSql(`alter table "manufacturing_uom_conversions" add constraint "manufacturing_uom_conversions_from_uom_id_foreign" foreign key ("from_uom_id") references "manufacturing_units_of_measure" ("id") on update cascade;`);
    this.addSql(`alter table "manufacturing_uom_conversions" add constraint "manufacturing_uom_conversions_to_uom_id_foreign" foreign key ("to_uom_id") references "manufacturing_units_of_measure" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "manufacturing_uom_conversions" cascade;`);
    this.addSql(`drop table if exists "product_manufacturing_extensions" cascade;`);
    this.addSql(`drop table if exists "manufacturing_supplier_infos" cascade;`);
    this.addSql(`drop table if exists "manufacturing_production_methods" cascade;`);
    this.addSql(`drop table if exists "manufacturing_units_of_measure" cascade;`);
  }
}
