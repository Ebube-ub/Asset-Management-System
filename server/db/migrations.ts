import { exec, one, query } from './index.js';

/**
 * Incremental, non-destructive migrations for databases created by Release 1.
 *
 * schema.sql only runs `create table if not exists`, so tables that already
 * exist keep their original columns and constraints. Everything that changes an
 * existing table lives here, is applied exactly once (tracked in _migration) and
 * never drops a row.
 */
type Migration = { id: string; sql: string };

const migrations: Migration[] = [
  {
    // Return-for-editing and category-level approval need two new request states.
    id: '2026-11-27-request-status',
    sql: `
      alter table request drop constraint if exists request_status_check;
      alter table request add constraint request_status_check
        check (status in ('raised','under_review','returned','awaiting_approval','rejected',
                          'in_progress','fulfilled','partly_fulfilled','closed','cancelled'));
    `,
  },
  {
    // Return-for-editing audit trail and the group-request marker.
    id: '2026-11-27-request-return-columns',
    sql: `
      alter table request add column if not exists is_group boolean not null default false;
      alter table request add column if not exists returned_by uuid references staff(id);
      alter table request add column if not exists returned_at timestamptz;
      alter table request add column if not exists return_reason text;
      alter table request add column if not exists resubmitted_at timestamptz;
    `,
  },
  {
    // Each unit on a group request can be addressed to a different person.
    id: '2026-11-27-request-item-recipient',
    sql: `alter table request_item add column if not exists recipient_staff_id uuid references staff(id);`,
  },
  {
    // Asset configuration: category link, hierarchy restriction, photo, handover.
    id: '2026-11-27-asset-configuration',
    sql: `
      alter table asset_type add column if not exists category_id uuid references asset_category(id);
      alter table asset add column if not exists photo_url text;
      alter table asset add column if not exists handover_status text;
      alter table asset drop constraint if exists asset_handover_status_check;
      alter table asset add constraint asset_handover_status_check
        check (handover_status in ('awaiting_handover','handed_over','collected','in_use','returned'));
      alter table purchase add column if not exists photo_url text;
    `,
  },
  {
    // Give every asset type a real category row, reusing the text it already had.
    id: '2026-11-27-backfill-categories',
    sql: `
      insert into asset_category (id, name, description)
      select gen_random_uuid(), c.name, null
        from (select distinct coalesce(nullif(trim(category), ''), 'General') as name from asset_type) c
       where not exists (select 1 from asset_category ac where lower(ac.name) = lower(c.name));

      update asset_type t
         set category_id = c.id
        from asset_category c
       where t.category_id is null and lower(c.name) = lower(coalesce(nullif(trim(t.category), ''), 'General'));
    `,
  },
  {
    // Approval levels that already exist in the business: air conditioners need
    // a head-of-department level sign-off, IT equipment is cleared by the line.
    id: '2026-11-27-seed-approval-defaults',
    sql: `
      update asset_category set approval_role = 'line_manager', min_request_role = null
       where name in ('IT Equipment', 'Furniture') and approval_role is null;
      update asset_category set approval_role = 'line_manager', min_request_role = 'line_manager'
       where name = 'Facilities Equipment' and approval_role is null;
      update asset_category set approval_role = 'line_manager'
       where approval_role is null and name not in ('Facilities Equipment');
    `,
  },
  {
    // Seed the common attributes so a laptop and an air conditioner capture
    // different fields straight away. Administrators can edit every one.
    id: '2026-11-27-seed-attributes',
    sql: `
      insert into asset_attribute (id, asset_type_id, key, label, field_type, options, required, position)
      select gen_random_uuid(), t.id, a.key, a.label, a.field_type, a.options, a.required, a.position
        from asset_type t
        join (
          select 'brand' as key, 'Brand' as label, 'text' as field_type, '{}'::text[] as options, true as required, 1 as position
          union all select 'model', 'Model', 'text', '{}'::text[], true, 2
          union all select 'ownership', 'Ownership', 'select', array['Owned','Leased','Donated'], true, 3
          union all select 'processor', 'Processor', 'text', '{}'::text[], false, 4
          union all select 'ram', 'RAM', 'text', '{}'::text[], false, 5
          union all select 'storage', 'Storage', 'text', '{}'::text[], false, 6
          union all select 'warranty', 'Warranty', 'text', '{}'::text[], false, 7
        ) a on lower(t.name) like '%laptop%'
       where not exists (select 1 from asset_attribute x where x.asset_type_id = t.id and x.key = a.key);

      insert into asset_attribute (id, asset_type_id, key, label, field_type, options, required, position)
      select gen_random_uuid(), t.id, a.key, a.label, a.field_type, a.options, a.required, a.position
        from asset_type t
        join (
          select 'brand' as key, 'Brand' as label, 'text' as field_type, '{}'::text[] as options, true as required, 1 as position
          union all select 'model', 'Model', 'text', '{}'::text[], true, 2
          union all select 'capacity', 'Capacity', 'text', '{}'::text[], false, 3
          union all select 'ownership', 'Ownership', 'select', array['Owned','Leased','Donated'], true, 4
          union all select 'installation_location', 'Installation location', 'text', '{}'::text[], false, 5
        ) a on lower(t.name) like '%air condition%'
       where not exists (select 1 from asset_attribute x where x.asset_type_id = t.id and x.key = a.key);

      insert into asset_attribute (id, asset_type_id, key, label, field_type, options, required, position)
      select gen_random_uuid(), t.id, 'brand', 'Brand', 'text', '{}'::text[], false, 1
        from asset_type t
       where not exists (select 1 from asset_attribute x where x.asset_type_id = t.id)
         and not exists (select 1 from asset_attribute y where y.asset_type_id = t.id);
    `,
  },
  {
    // Give the remaining seeded types fields that suit them rather than a single
    // "Brand". Only missing keys are added, so edits made in Asset Configuration win.
    id: '2026-11-27-seed-attributes-more',
    sql: `
      insert into asset_attribute (id, asset_type_id, key, label, field_type, options, required, position)
      select gen_random_uuid(), t.id, a.key, a.label, a.field_type, a.options, a.required, a.position
        from asset_type t
        join (values
          ('monitor', 'size', 'Screen size', 'text', '{}'::text[], false, 2),
          ('monitor', 'panel', 'Panel type', 'select', array['IPS','VA','TN','OLED'], false, 3),
          ('monitor', 'ownership', 'Ownership', 'select', array['Owned','Leased','Donated'], true, 4),
          ('monitor', 'warranty', 'Warranty', 'text', '{}'::text[], false, 5),
          ('ip phone', 'model', 'Model', 'text', '{}'::text[], true, 2),
          ('ip phone', 'extension', 'Extension', 'text', '{}'::text[], false, 3),
          ('ip phone', 'ownership', 'Ownership', 'select', array['Owned','Leased','Donated'], true, 4),
          ('switch', 'model', 'Model', 'text', '{}'::text[], true, 2),
          ('switch', 'ports', 'Ports', 'number', '{}'::text[], false, 3),
          ('switch', 'ownership', 'Ownership', 'select', array['Owned','Leased','Donated'], true, 4),
          ('switch', 'warranty', 'Warranty', 'text', '{}'::text[], false, 5),
          ('chair', 'material', 'Material', 'select', array['Mesh','Fabric','Leather'], false, 2),
          ('chair', 'colour', 'Colour', 'text', '{}'::text[], false, 3),
          ('chair', 'ownership', 'Ownership', 'select', array['Owned','Leased','Donated'], true, 4),
          ('chair', 'condition', 'Condition', 'select', array['New','Good','Fair','Poor'], false, 5),
          ('desk', 'size', 'Size', 'text', '{}'::text[], false, 2),
          ('desk', 'ownership', 'Ownership', 'select', array['Owned','Leased','Donated'], true, 3),
          ('desk', 'condition', 'Condition', 'select', array['New','Good','Fair','Poor'], false, 4),
          ('projector', 'model', 'Model', 'text', '{}'::text[], true, 2),
          ('projector', 'resolution', 'Resolution', 'text', '{}'::text[], false, 3),
          ('projector', 'ownership', 'Ownership', 'select', array['Owned','Leased','Donated'], true, 4),
          ('projector', 'warranty', 'Warranty', 'text', '{}'::text[], false, 5)
        ) as a(pattern, key, label, field_type, options, required, position)
          on lower(t.name) like '%' || a.pattern || '%'
       where not exists (select 1 from asset_attribute x where x.asset_type_id = t.id and x.key = a.key);
    `,
  },
  {
    // Asset Class becomes the top of the configuration hierarchy. Approval rules
    // can be set at class, category or type level; the most specific one wins.
    id: '2026-11-28-asset-class',
    sql: `
      create table if not exists asset_class (
        id uuid primary key,
        name text not null unique,
        description text,
        approval_role text check (approval_role in ('team_lead','line_manager','stock_manager','financial_executive','administrator')),
        approval_stage integer not null default 1,
        min_request_role text check (min_request_role in ('team_lead','line_manager','stock_manager','financial_executive','administrator')),
        active boolean not null default true,
        created_at timestamptz not null default now()
      );
      alter table asset_category add column if not exists class_id uuid references asset_class(id);
      alter table asset_type add column if not exists approval_role text;
      alter table asset_type add column if not exists approval_stage integer;
      alter table asset_type add column if not exists min_request_role text;
      create index if not exists asset_category_class_idx on asset_category(class_id);
      create index if not exists asset_type_category_idx on asset_type(category_id);
    `,
  },
  {
    // Place every existing category under a class without touching its rows, then
    // make the hierarchy mandatory. Existing assets and requests keep their type.
    id: '2026-11-28-asset-class-backfill',
    sql: `
      insert into asset_class (id, name, description)
      select gen_random_uuid(), v.name, v.description
        from (values
          ('IT Equipment', 'Computers, peripherals, networking and communications equipment.'),
          ('Office Equipment', 'General office machinery and presentation equipment.'),
          ('Furniture', 'Desks, seating and other workplace furniture.'),
          ('Facilities Equipment', 'Building services equipment such as air conditioning and power.'),
          ('Vehicles', 'Company vehicles and mobile plant.')
        ) as v(name, description)
       where not exists (select 1 from asset_class c where lower(c.name) = lower(v.name));

      update asset_category c
         set class_id = cl.id
        from asset_class cl
       where c.class_id is null
         and cl.name = case
           when lower(c.name) in ('it equipment','av equipment','computing devices','networking equipment') then 'IT Equipment'
           when lower(c.name) in ('furniture','office seating','desks and tables') then 'Furniture'
           when lower(c.name) in ('facilities','facilities equipment','air conditioning') then 'Facilities Equipment'
           when lower(c.name) = 'vehicles' then 'Vehicles'
           else 'Office Equipment'
         end;

      update asset_category
         set class_id = (select id from asset_class where name = 'Office Equipment')
       where class_id is null;

      -- Anything still without a category needs a home before the column is enforced.
      insert into asset_category (id, class_id, name, description)
      select gen_random_uuid(), (select id from asset_class where name = 'Office Equipment'),
             'Unclassified', 'Types migrated from the earlier flat configuration.'
       where exists (select 1 from asset_type where category_id is null)
         and not exists (select 1 from asset_category where name = 'Unclassified');

      update asset_type
         set category_id = (select id from asset_category where name = 'Unclassified')
       where category_id is null;

      alter table asset_category alter column class_id set not null;
      alter table asset_type alter column category_id set not null;
    `,
  },
];

export async function applyMigrations(): Promise<string[]> {
  const applied: string[] = [];
  for (const migration of migrations) {
    const done = await one<{ id: string }>(`select id from _migration where id = $1`, [migration.id]);
    if (done) continue;
    await exec(migration.sql);
    await query(`insert into _migration (id) values ($1) on conflict do nothing`, [migration.id]);
    applied.push(migration.id);
  }
  return applied;
}

