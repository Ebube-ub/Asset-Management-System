import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError, parseBody } from '../lib/http.js';
import { iso, uid } from '../lib/repo.js';
import { ALL_ROLES, type Role } from '../../shared/domain.js';

/**
 * Asset Configuration: categories, the types inside them, the fields each type
 * captures, and the approval/restriction level that applies to the category.
 */

const roleEnum = z.enum(['team_lead', 'line_manager', 'stock_manager', 'financial_executive', 'administrator']);

export async function configurationOverview() {
  const categories = await query<Record<string, unknown>>(
    `select c.id, c.name, c.description, c.approval_role as "approvalRole", c.approval_stage as "approvalStage",
            c.min_request_role as "minRequestRole", c.active, c.created_at as "createdAt",
            (select count(*) from asset_type t where t.category_id = c.id and t.active = true)::int as "typeCount",
            (select count(*) from asset a join asset_type t on t.id = a.asset_type_id
              where t.category_id = c.id)::int as "assetCount"
       from asset_category c
      order by c.name`,
  );

  const types = await query<Record<string, unknown>>(
    `select t.id, t.name, t.custody_kind as "custodyKind", t.category, t.category_id as "categoryId",
            t.description, t.active, t.created_at as "createdAt",
            c.name as "categoryName", c.approval_role as "approvalRole", c.min_request_role as "minRequestRole",
            (select count(*) from asset_attribute at where at.asset_type_id = t.id and at.active = true)::int as "attributeCount",
            (select count(*) from asset a where a.asset_type_id = t.id and a.status = 'available')::int as "availableCount",
            (select count(*) from asset a where a.asset_type_id = t.id and a.status = 'assigned')::int as "assignedCount",
            (select count(*) from asset a where a.asset_type_id = t.id)::int as "totalCount"
       from asset_type t left join asset_category c on c.id = t.category_id
      order by coalesce(c.name, t.category), t.name`,
  );

  const attributes = await query<Record<string, unknown>>(
    `select a.id, a.asset_type_id as "assetTypeId", a.key, a.label, a.field_type as "fieldType",
            a.options, a.required, a.position, a.active
       from asset_attribute a
      order by a.asset_type_id, a.position, a.label`,
  );

  const typeIds = types.map((t) => String(t.id));
  const values = typeIds.length
    ? await query<{ attribute_id: string; count: string }>(
        `select v.attribute_id, count(*)::text as count
           from asset_attribute_value v join asset_attribute a on a.id = v.attribute_id
          where a.asset_type_id = any($1::uuid[]) group by v.attribute_id`,
        [typeIds],
      )
    : [];

  return {
    categories: categories.map((c) => ({
      ...c,
      createdAt: iso(c.createdAt),
      typeCount: Number(c.typeCount),
      assetCount: Number(c.assetCount),
    })),
    types: types.map((t) => ({
      ...t,
      createdAt: iso(t.createdAt),
      attributeCount: Number(t.attributeCount),
      availableCount: Number(t.availableCount),
      assignedCount: Number(t.assignedCount),
      totalCount: Number(t.totalCount),
      attributes: attributes
        .filter((a) => a.assetTypeId === t.id)
        .map((a) => ({
          ...a,
          options: (a.options as string[]) ?? [],
          usedCount: Number(values.find((v) => v.attribute_id === a.id)?.count ?? 0),
        })),
    })),
    roles: ALL_ROLES,
  };
}

const categorySchema = z.object({
  name: z.string().trim().min(1, 'A category name is required.'),
  description: z.string().trim().max(500).optional().nullable(),
  approvalRole: roleEnum.nullable().optional(),
  minRequestRole: roleEnum.nullable().optional(),
  active: z.boolean().optional(),
});

export async function createCategory(body: unknown) {
  const input = parseBody(categorySchema, body);
  const existing = await one(`select 1 from asset_category where lower(name) = lower($1)`, [input.name]);
  if (existing) throw new ApiError(409, 'An asset category with that name already exists.');
  const id = uid();
  await query(
    `insert into asset_category (id, name, description, approval_role, min_request_role)
     values ($1,$2,$3,$4,$5)`,
    [id, input.name, input.description ?? null, input.approvalRole ?? null, input.minRequestRole ?? null],
  );
  return { id };
}

export async function updateCategory(categoryId: string, body: unknown) {
  const input = parseBody(categorySchema.partial(), body);
  if (input.name) {
    const clash = await one(`select 1 from asset_category where lower(name) = lower($1) and id <> $2`, [
      input.name,
      categoryId,
    ]);
    if (clash) throw new ApiError(409, 'Another category already uses that name.');
  }
  await query(
    `update asset_category
        set name = coalesce($2, name),
            description = coalesce($3, description),
            approval_role = case when $4 then $5::text else approval_role end,
            min_request_role = case when $6 then $7::text else min_request_role end,
            active = coalesce($8, active)
      where id = $1`,
    [
      categoryId,
      input.name ?? null,
      input.description ?? null,
      input.approvalRole !== undefined,
      input.approvalRole ?? null,
      input.minRequestRole !== undefined,
      input.minRequestRole ?? null,
      input.active ?? null,
    ],
  );
  return { ok: true };
}

const attributeSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Every field needs a key.')
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Use lower-case letters, numbers and underscores for the key.'),
  label: z.string().trim().min(1, 'Every field needs a label.').max(80),
  fieldType: z.enum(['text', 'number', 'select', 'date', 'checkbox']),
  options: z.array(z.string().trim().min(1)).max(30).optional().nullable(),
  required: z.boolean().optional(),
  position: z.coerce.number().int().min(0).max(999).optional(),
});

const assetTypeSchema = z.object({
  name: z.string().trim().min(1, 'A name is required.'),
  custodyKind: z.enum(['person', 'location']),
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
  attributes: z.array(attributeSchema).max(40).optional(),
});

export async function createAssetTypeRecord(body: unknown) {
  const input = parseBody(assetTypeSchema, body);
  const clash = await one(`select 1 from asset_type where lower(name) = lower($1)`, [input.name]);
  if (clash) throw new ApiError(409, 'An asset type with that name already exists.');
  const category = input.categoryId
    ? await one<{ id: string; name: string }>(`select id, name from asset_category where id = $1`, [input.categoryId])
    : null;
  if (input.categoryId && !category) throw new ApiError(400, 'Choose a valid category.');
  const id = uid();
  await withTransaction(async (tx) => {
    await tx.query(
      `insert into asset_type (id, name, custody_kind, category, category_id, description)
       values ($1,$2,$3,$4,$5,$6)`,
      [id, input.name, input.custodyKind, category?.name ?? 'General', category?.id ?? null, input.description ?? null],
    );
    if (input.attributes?.length) {
      for (const [index, attribute] of input.attributes.entries()) {
        await tx.query(
          `insert into asset_attribute (id, asset_type_id, key, label, field_type, options, required, position)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            uid(),
            id,
            attribute.key,
            attribute.label,
            attribute.fieldType,
            attribute.options ?? [],
            attribute.required ?? false,
            attribute.position ?? index,
          ],
        );
      }
    }
  });
  return { id };
}

export async function updateAssetTypeRecord(typeId: string, body: unknown) {
  const input = parseBody(assetTypeSchema.partial(), body);
  const type = await one<{ id: string }>(`select id from asset_type where id = $1`, [typeId]);
  if (!type) throw new ApiError(404, 'Asset type not found.');
  if (input.name) {
    const clash = await one(`select 1 from asset_type where lower(name) = lower($1) and id <> $2`, [
      input.name,
      typeId,
    ]);
    if (clash) throw new ApiError(409, 'Another asset type already uses that name.');
  }
  const category = input.categoryId
    ? await one<{ id: string; name: string }>(`select id, name from asset_category where id = $1`, [input.categoryId])
    : null;
  if (input.categoryId && !category) throw new ApiError(400, 'Choose a valid category.');

  await withTransaction(async (tx) => {
    await tx.query(
      `update asset_type
          set name = coalesce($2, name),
              custody_kind = coalesce($3, custody_kind),
              category = coalesce($4, category),
              category_id = case when $5 then $6::uuid else category_id end,
              description = coalesce($7, description),
              active = coalesce($8, active)
        where id = $1`,
      [
        typeId,
        input.name ?? null,
        input.custodyKind ?? null,
        category?.name ?? null,
        input.categoryId !== undefined,
        input.categoryId ?? null,
        input.description ?? null,
        input.active ?? null,
      ],
    );

    if (input.attributes) {
      const keep = new Set(input.attributes.map((a) => a.key));
      const existing = await tx.query<{ id: string; key: string }>(
        `select id, key from asset_attribute where asset_type_id = $1`,
        [typeId],
      );
      // Fields with captured values are retired, never deleted.
      for (const row of existing) {
        if (!keep.has(row.key)) {
          await tx.query(`update asset_attribute set active = false where id = $1`, [row.id]);
        }
      }
      for (const [index, attribute] of input.attributes.entries()) {
        await tx.query(
          `insert into asset_attribute (id, asset_type_id, key, label, field_type, options, required, position, active)
           values ($1,$2,$3,$4,$5,$6,$7,$8,true)
           on conflict (asset_type_id, key) do update
             set label = excluded.label, field_type = excluded.field_type, options = excluded.options,
                 required = excluded.required, position = excluded.position, active = true`,
          [
            uid(),
            typeId,
            attribute.key,
            attribute.label,
            attribute.fieldType,
            attribute.options ?? [],
            attribute.required ?? false,
            attribute.position ?? index,
          ],
        );
      }
    }
  });
  return { ok: true };
}

/** Active fields for one asset type, in display order. */
export async function fieldsForType(typeId: string) {
  return query<{
    id: string;
    key: string;
    label: string;
    field_type: string;
    options: string[] | null;
    required: boolean;
    position: number;
  }>(
    `select id, key, label, field_type, options, required, position
       from asset_attribute where asset_type_id = $1 and active = true
      order by position, label`,
    [typeId],
  );
}

/** Validate and store the captured values for an asset against its type's fields. */
export async function saveAttributeValues(
  tx: { query: typeof query },
  assetId: string,
  assetTypeId: string,
  values: Record<string, unknown> | undefined,
) {
  const fields = await tx.query<{ id: string; key: string; label: string; field_type: string; required: boolean }>(
    `select id, key, label, field_type, required from asset_attribute
      where asset_type_id = $1 and active = true`,
    [assetTypeId],
  );
  const provided = values ?? {};
  for (const field of fields) {
    const raw = provided[field.key];
    const empty = raw === undefined || raw === null || raw === '';
    if (field.required && empty) {
      throw new ApiError(400, `${field.label} is required for this asset type.`);
    }
    if (empty) {
      await tx.query(`delete from asset_attribute_value where asset_id = $1 and attribute_id = $2`, [
        assetId,
        field.id,
      ]);
      continue;
    }
    if (field.field_type === 'number' && Number.isNaN(Number(raw))) {
      throw new ApiError(400, `${field.label} must be a number.`);
    }
    if (field.field_type === 'checkbox' && !['true', 'false'].includes(String(raw))) {
      throw new ApiError(400, `${field.label} must be yes or no.`);
    }
    const value =
      field.field_type === 'checkbox' ? String(raw === true || raw === 'true') : String(raw).slice(0, 500);
    await tx.query(
      `insert into asset_attribute_value (asset_id, attribute_id, value) values ($1,$2,$3)
       on conflict (asset_id, attribute_id) do update set value = excluded.value`,
      [assetId, field.id, value],
    );
  }
}

export type ConfigRole = Role;
