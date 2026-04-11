import { Migration } from '@mikro-orm/migrations';

/**
 * Initial migration for manufacturing configurator module.
 *
 * SQL hand-written based on entity definitions (db:generate bug for external packages).
 * Creates 2 tables: config_attributes, constraint_rules.
 */
export class Migration20260404000004 extends Migration {

  override async up(): Promise<void> {
    // Tables
    this.addSql(`create table "manufacturing_config_attributes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "key" varchar(100) not null, "label" varchar(255) not null, "attribute_type" varchar(20) not null default 'enum', "allowed_values" jsonb null, "material_filter_id" uuid null, "is_mandatory" boolean not null default true, "display_order" int not null default 0, "default_value" varchar(255) null, "attribute_group" varchar(100) null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_config_attributes_pkey" primary key ("id"));`);

    this.addSql(`create table "manufacturing_constraint_rules" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "condition_json" jsonb not null, "action_type" varchar(30) not null, "action_data" jsonb not null, "priority" int not null default 0, "description" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_constraint_rules_pkey" primary key ("id"));`);

    // Indexes — ConfigAttribute
    this.addSql(`create index "manufacturing_ca_org_tenant_idx" on "manufacturing_config_attributes" ("organization_id", "tenant_id");`);
    this.addSql(`create unique index "manufacturing_ca_key_scope_unique" on "manufacturing_config_attributes" ("organization_id", "tenant_id", "product_id", "key") where "deleted_at" is null;`);
    this.addSql(`create index "manufacturing_ca_org_product_order_idx" on "manufacturing_config_attributes" ("organization_id", "product_id", "display_order");`);

    // Indexes — ConstraintRule
    this.addSql(`create index "manufacturing_cr_org_tenant_idx" on "manufacturing_constraint_rules" ("organization_id", "tenant_id");`);
    this.addSql(`create index "manufacturing_cr_org_product_priority_idx" on "manufacturing_constraint_rules" ("organization_id", "product_id", "priority" desc);`);
    this.addSql(`create index "manufacturing_cr_org_product_active_idx" on "manufacturing_constraint_rules" ("organization_id", "product_id", "is_active");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "manufacturing_constraint_rules" cascade;`);
    this.addSql(`drop table if exists "manufacturing_config_attributes" cascade;`);
  }
}
