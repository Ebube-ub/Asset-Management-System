import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError, parseBody } from '../lib/http.js';
import { iso, uid } from '../lib/repo.js';
import { ALL_ROLES, type Role } from '../../shared/domain.js';

/**
 * Asset Configuration: the Asset Class → Asset Category → Asset Type hierarchy,
 * the fields each type captures, and the approval/restriction rules that apply
 * at each level. The most specific rule wins: type, then category, then class.
 */

const roleEnum = z.enum(['team_lead', 'line_manager', 'stock_manager', 'financial_executive', 'administrator']);
const stageSchema = z.coerce.number().int().min(1).max(20);

export async function configurationOverview() {
  const classes = await query<Record<string, unknown>>(
    `select cl.id, cl.name, cl.description, cl.approval_role as "approvalRole",
            cl.approval_stage as "approvalStage", cl.min_request_role as "minRequestRole",
            cl.active, cl.created_at as "createdAt",
            (select count(*) from asset_category c where c.class_id = cl.id)::int as "categoryCount",
            (select count(*) from asset_type t join asset_category c on c.id = t.category_id
              where c.class_id = cl.id)::int as "typeCount",
            (select count(*) from asset a join asset_type t on t.id = a.asset_type_id
              join asset_category c on c.id = t.category_id
              where c.class_id = cl.id)::int as "assetCount"
       from asset_class cl
      order by cl.name`,
  );

  const categories = await query<Record<string, unknown>>(
    `select c.id, c.class_id as "classId", cl.name as "className", cl.active as "classActive",
            c.name, c.description, c.approval_role as "approvalRole", c.approval_stage as "approvalStage",
            c.min_request_role as "minRequestRole",
            cl.approval_role as "classApprovalRole", cl.approval_stage as "classApprovalStage",
            cl.min_request_role as "classMinRequestRole",
            c.active, c.created_at as "createdAt",
            coalesce(c.approval_role, cl.approval_role) as "effectiveApprovalRole",
            coalesce(c.approval_stage, cl.approval_stage) as "effectiveApprovalStage",
            coalesce(c.min_request_role, cl.min_request_role) as "effectiveMinRequestRole",
            (select count(*) from asset_type t where t.category_id = c.id and t.active = true)::int as "typeCount",
            (select count(*) from asset a join asset_type t on t.id = a.asset_type_id
              where t.category_id = c.id)::int as "assetCount"
       from asset_category c
       join asset_class cl on cl.id = c.class_id
      order by cl.name, c.name`,
  );

  const types = await query<Record<string, unknown>>(
    `select t.id, t.name, t.custody_kind as "custodyKind", t.category,
            t.category_id as "categoryId", c.name as "categoryName", c.active as "categoryActive",
            cl.id as "classId", cl.name as "className", cl.active as "classActive",
            t.description, t.active, t.created_at as "createdAt",
            t.approval_role as "approvalRole", t.approval_stage as "approvalStage",
            t.min_request_role as "minRequestRole",
            c.approval_role as "categoryApprovalRole", c.approval_stage as "categoryApprovalStage",
            c.min_request_role as "categoryMinRequestRole",
            cl.approval_role as "classApprovalRole", cl.approval_stage as "classApprovalStage",
            cl.min_request_role as "classMinRequestRole",
            coalesce(t.approval_role, c.approval_role, cl.approval_role) as "effectiveApprovalRole",
            coalesce(t.approval_stage, c.approval_stage, cl.approval_stage) as "effectiveApprovalStage",
            coalesce(t.min_request_role, c.min_request_role, cl.min_request_role) as "effectiveMinRequestRole",
            (select count(*) from asset_attribute at where at.asset_type_id = t.id and at.active = true)::int as "attributeCount",
            (select count(*) from asset a where a.asset_type_id = t.id and a.status = 'available')::int as "availableCount",
            (select count(*) from asset a where a.asset_type_id = t.id and a.status = 'assigned')::int as "assignedCount",
            (select count(*) from asset a where a.asset_type_id = t.id)::int as "totalCount"
       from asset_type t
       join asset_category c on c.id = t.category_id
       join asset_class cl on cl.id = c.class_id
      order by cl.name, c.name, t.name`,
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
    classes: classes.map((c) => ({
      ...c,
      createdAt: iso(c.createdAt),
      categoryCount: Number(c.categoryCount),
      typeCount: Number(c.typeCount),
      assetCount: Number(c.assetCount),
    })),
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

// ---------------------------------------------------------------------------
// Asset classes
// ---------------------------------------------------------------------------

const classSchema = z.object({
  name: z.string().trim().min(1, 'An asset class name is required.').max(120),
  description: z.string().trim().max(500).optional().nullable(),
  approvalRole: roleEnum.nullable().optional(),
  approvalStage: stageSchema.optional(),
  minRequestRole: roleEnum.nullable().optional(),
  active: z.boolean().optional(),
});

export async function createClass(body: unknown) {
  const input = parseBody(classSchema, body);
  const existing = await one(`select 1 from asset_class where lower(name) = lower($1)`, [input.name]);
  if (existing) throw new ApiError(409, 'An asset class with that name already exists.');
  const id = uid();
  await query(
    `insert into asset_class (id, name, description, approval_role, approval_stage, min_request_role)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      id,
      input.name,
      input.description ?? null,
      input.approvalRole ?? null,
      input.approvalStage ?? 1,
      input.minRequestRole ?? null,
    ],
  );
  return { id };
}

export async function updateClass(classId: string, body: unknown) {
  const input = parseBody(classSchema.partial(), body);
  const current = await one(`select id from asset_class where id = $1`, [classId]);
  if (!current) throw new ApiError(404, 'Asset class not found.');
  if (input.name) {
    const clash = await one(`select 1 from asset_class where lower(name) = lower($1) and id <> $2`, [
      input.name,
      classId,
    ]);
    if (clash) throw new ApiError(409, 'Another asset class already uses that name.');
  }
  await query(
    `update asset_class
        set name = coalesce($2, name),
            description = coalesce($3, description),
            approval_role = case when $4 then $5::text else approval_role end,
            approval_stage = coalesce($6, approval_stage),
            min_request_role = case when $7 then $8::text else min_request_role end,
            active = coalesce($9, active)
      where id = $1`,
    [
      classId,
      input.name ?? null,
      input.description ?? null,
      input.approvalRole !== undefined,
      input.approvalRole ?? null,
      input.approvalStage ?? null,
      input.minRequestRole !== undefined,
      input.minRequestRole ?? null,
      input.active ?? null,
    ],
  );
  return { ok: true };
}

/** A class that still owns categories cannot be deleted. */
export async function deleteClass(classId: string) {
  const classRow = await one<{ id: string; name: string }>(`select id, name from asset_class where id = $1`, [classId]);
  if (!classRow) throw new ApiError(404, 'Asset class not found.');
  const inUse = await one<{ count: number }>(
    `select count(*)::int as count from asset_category where class_id = $1`,
    [classId],
  );
  if (Number(inUse?.count ?? 0) > 0) {
    throw new ApiError(
      409,
      `"${classRow.name}" still contains ${inUse?.count} categor${Number(inUse?.count) === 1 ? 'y' : 'ies'}. Move or delete them first, or set the class to inactive.`,
    );
  }
  await query(`delete from asset_class where id = $1`, [classId]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Asset categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  classId: z.string().uuid('Choose the asset class this category belongs to.'),
  name: z.string().trim().min(1, 'A category name is required.').max(120),
  description: z.string().trim().max(500).optional().nullable(),
  approvalRole: roleEnum.nullable().optional(),
  approvalStage: stageSchema.optional(),
  minRequestRole: roleEnum.nullable().optional(),
  active: z.boolean().optional(),
});

export async function createCategory(body: unknown) {
  const input = parseBody(categorySchema, body);
  const classRow = await one<{ id: string }>(`select id from asset_class where id = $1`, [input.classId]);
  if (!classRow) throw new ApiError(400, 'Choose a valid asset class.');
  const existing = await one(`select 1 from asset_category where lower(name) = lower($1)`, [input.name]);
  if (existing) throw new ApiError(409, 'An asset category with that name already exists.');
  const id = uid();
  await query(
    `insert into asset_category (id, class_id, name, description, approval_role, approval_stage, min_request_role)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      input.classId,
      input.name,
      input.description ?? null,
      input.approvalRole ?? null,
      input.approvalStage ?? 1,
      input.minRequestRole ?? null,
    ],
  );
  return { id };
}

export async function updateCategory(categoryId: string, body: unknown) {
  const input = parseBody(categorySchema.partial(), body);
  const current = await one(`select id from asset_category where id = $1`, [categoryId]);
  if (!current) throw new ApiError(404, 'Asset category not found.');
  if (input.name) {
    const clash = await one(`select 1 from asset_category where lower(name) = lower($1) and id <> $2`, [
      input.name,
      categoryId,
    ]);
    if (clash) throw new ApiError(409, 'Another category already uses that name.');
  }
  if (input.classId) {
    const classRow = await one(`select 1 from asset_class where id = $1`, [input.classId]);
    if (!classRow) throw new ApiError(400, 'Choose a valid asset class.');
  }
  await query(
    `update asset_category
        set class_id = case when $2 then $3::uuid else class_id end,
            name = coalesce($4, name),
            description = coalesce($5, description),
            approval_role = case when $6 then $7::text else approval_role end,
            approval_stage = coalesce($8, approval_stage),
            min_request_role = case when $9 then $10::text else min_request_role end,
            active = coalesce($11, active)
      where id = $1`,
    [
      categoryId,
      input.classId !== undefined,
      input.classId ?? null,
      input.name ?? null,
      input.description ?? null,
      input.approvalRole !== undefined,
      input.approvalRole ?? null,
      input.approvalStage ?? null,
      input.minRequestRole !== undefined,
      input.minRequestRole ?? null,
      input.active ?? null,
    ],
  );
  return { ok: true };
}

export async function deleteCategory(categoryId: string) {
  const category = await one<{ id: string; name: string }>(`select id, name from asset_category where id = $1`, [
    categoryId,
  ]);
  if (!category) throw new ApiError(404, 'Asset category not found.');
  const types = await one<{ count: number }>(`select count(*)::int as count from asset_type where category_id = $1`, [
    categoryId,
  ]);
  if (Number(types?.count ?? 0) > 0) {
    throw new ApiError(
      409,
      `"${category.name}" still contains ${types?.count} asset type${Number(types?.count) === 1 ? '' : 's'}. Move or delete them first, or set the category to inactive.`,
    );
  }
  await query(`delete from asset_category where id = $1`, [categoryId]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Asset types and their fields
// ---------------------------------------------------------------------------

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
  name: z.string().trim().min(1, 'A name is required.').max(120),
  custodyKind: z.enum(['person', 'location']),
  categoryId: z.string().uuid('Choose the asset category for this type.'),
  description: z.string().trim().max(500).optional().nullable(),
  approvalRole: roleEnum.nullable().optional(),
  approvalStage: stageSchema.nullable().optional(),
  minRequestRole: roleEnum.nullable().optional(),
  active: z.boolean().optional(),
  attributes: z.array(attributeSchema).max(40).optional(),
});

async function categoryWithClass(categoryId: string) {
  return one<{ id: string; name: string; class_id: string; class_name: string }>(
    `select c.id, c.name, c.class_id, cl.name as class_name
       from asset_category c join asset_class cl on cl.id = c.class_id
      where c.id = $1`,
    [categoryId],
  );
}

export async function createAssetTypeRecord(body: unknown) {
  const input = parseBody(assetTypeSchema, body);
  const clash = await one(`select 1 from asset_type where lower(name) = lower($1)`, [input.name]);
  if (clash) throw new ApiError(409, 'An asset type with that name already exists.');
  const category = await categoryWithClass(input.categoryId);
  if (!category) throw new ApiError(400, 'Choose a valid asset category.');
  const id = uid();
  await withTransaction(async (tx) => {
    await tx.query(
      `insert into asset_type (id, name, custody_kind, category, category_id, description,
                               approval_role, approval_stage, min_request_role)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        input.name,
        input.custodyKind,
        category.name,
        category.id,
        input.description ?? null,
        input.approvalRole ?? null,
        input.approvalStage ?? null,
        input.minRequestRole ?? null,
      ],
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
  const category = input.categoryId ? await categoryWithClass(input.categoryId) : null;
  if (input.categoryId && !category) throw new ApiError(400, 'Choose a valid asset category.');

  await withTransaction(async (tx) => {
    await tx.query(
      `update asset_type
          set name = coalesce($2, name),
              custody_kind = coalesce($3, custody_kind),
              category = coalesce($4, category),
              category_id = case when $5 then $6::uuid else category_id end,
              description = coalesce($7, description),
              approval_role = case when $8 then $9::text else approval_role end,
              approval_stage = case when $10 then $11::int else approval_stage end,
              min_request_role = case when $12 then $13::text else min_request_role end,
              active = coalesce($14, active)
        where id = $1`,
      [
        typeId,
        input.name ?? null,
        input.custodyKind ?? null,
        category?.name ?? null,
        input.categoryId !== undefined,
        input.categoryId ?? null,
        input.description ?? null,
        input.approvalRole !== undefined,
        input.approvalRole ?? null,
        input.approvalStage !== undefined,
        input.approvalStage ?? null,
        input.minRequestRole !== undefined,
        input.minRequestRole ?? null,
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

/** A type used by an asset or a request line is history: it can only be deactivated. */
export async function deleteAssetType(typeId: string) {
  const type = await one<{ id: string; name: string }>(`select id, name from asset_type where id = $1`, [typeId]);
  if (!type) throw new ApiError(404, 'Asset type not found.');
  const usage = await one<{ assets: number; requests: number }>(
    `select (select count(*) from asset where asset_type_id = $1)::int as assets,
            (select count(*) from request_line where asset_type_id = $1)::int as requests`,
    [typeId],
  );
  if (Number(usage?.assets ?? 0) > 0 || Number(usage?.requests ?? 0) > 0) {
    throw new ApiError(
      409,
      `"${type.name}" is linked to ${usage?.assets} asset${Number(usage?.assets) === 1 ? '' : 's'} and ${usage?.requests} request line${Number(usage?.requests) === 1 ? '' : 's'}. It cannot be deleted; set it to inactive instead so the history stays intact.`,
    );
  }
  await query(`delete from asset_type where id = $1`, [typeId]);
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
