import { Migration } from '@mikro-orm/migrations';

/**
 * Initial migration for manufacturing bom module.
 *
 * SQL extracted from `yarn db:generate` output (MikroORM decorator-driven),
 * curated to only this module's 3 tables. See migration playbook in moldo docs.
 */
export class Migration20260404000002 extends Migration {

  override async up(): Promise<void> {
    // Tables
    this.addSql(`create table "manufacturing_bom_headers" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "production_method_id" uuid null, "name" varchar(255) not null, "bom_usage" varchar(20) not null default 'production', "is_phantom" boolean not null default false, "is_active" boolean not null default true, "version" int not null default 1, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_bom_headers_pkey" primary key ("id"));`);

    this.addSql(`create table "manufacturing_bom_lines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "bom_header_id" uuid not null, "line_type" text not null default 'material', "material_id" uuid null, "child_bom_header_id" uuid null, "net_quantity" numeric(18,4) null, "gross_quantity" numeric(18,4) null, "scrap_percentage" numeric(5,2) not null default 0, "uom_id" uuid null, "variant_condition" jsonb null, "operation_template_id" uuid null, "sort_order" int not null default 0, "valid_from" timestamptz null, "valid_to" timestamptz null, "is_consumable" boolean not null default false, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_bom_lines_pkey" primary key ("id"));`);

    this.addSql(`create table "manufacturing_bom_line_variants" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "bom_line_id" uuid not null, "variant_id" uuid null, "variant_condition" jsonb null, "quantity_override" numeric(18,4) null, "material_override_id" uuid null, "unit_override_id" uuid null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "manufacturing_bom_line_variants_pkey" primary key ("id"));`);

    // Indexes — BomHeader
    this.addSql(`create index "manufacturing_bom_org_product_active_idx" on "manufacturing_bom_headers" ("organization_id", "product_id", "is_active");`);
    this.addSql(`create index "manufacturing_bom_org_pm_idx" on "manufacturing_bom_headers" ("organization_id", "production_method_id");`);

    // Indexes — BomLine
    this.addSql(`create index "manufacturing_bl_header_sort_idx" on "manufacturing_bom_lines" ("bom_header_id", "sort_order");`);
    this.addSql(`create index "manufacturing_bl_org_material_idx" on "manufacturing_bom_lines" ("organization_id", "material_id");`);
    this.addSql(`create index "manufacturing_bl_header_dates_idx" on "manufacturing_bom_lines" ("bom_header_id", "valid_from", "valid_to");`);

    // Indexes — BomLineVariant
    this.addSql(`create index "manufacturing_blv_line_variant_idx" on "manufacturing_bom_line_variants" ("bom_line_id", "variant_id");`);
    this.addSql(`create index "manufacturing_blv_line_idx" on "manufacturing_bom_line_variants" ("bom_line_id");`);

    // CHECK constraint — variant_id XOR variant_condition
    this.addSql(`alter table "manufacturing_bom_line_variants" add constraint "manufacturing_blv_variant_xor" check (("variant_id" IS NOT NULL AND "variant_condition" IS NULL) OR ("variant_id" IS NULL AND "variant_condition" IS NOT NULL));`);

    // Foreign keys (within module)
    this.addSql(`alter table "manufacturing_bom_lines" add constraint "manufacturing_bom_lines_bom_header_id_foreign" foreign key ("bom_header_id") references "manufacturing_bom_headers" ("id") on update cascade;`);
    this.addSql(`alter table "manufacturing_bom_line_variants" add constraint "manufacturing_bom_line_variants_bom_line_id_foreign" foreign key ("bom_line_id") references "manufacturing_bom_lines" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "manufacturing_bom_line_variants" cascade;`);
    this.addSql(`drop table if exists "manufacturing_bom_lines" cascade;`);
    this.addSql(`drop table if exists "manufacturing_bom_headers" cascade;`);
  }
}
