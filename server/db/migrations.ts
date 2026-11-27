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

