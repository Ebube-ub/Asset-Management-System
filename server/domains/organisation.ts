import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError, parseBody } from '../lib/http.js';
import { hashPassword, type CurrentUser } from '../lib/auth.js';
import { addAssetHistory, addRequestHistory, iso, uid } from '../lib/repo.js';
import { ALL_ROLES, type Role } from '../../shared/domain.js';

export async function staffDirectory() {
  const rows = await query<any>(
    `select s.id, s.name, s.email, s.job_title as "jobTitle", s.manager_id as "managerId",
            s.first_signed_in_at as "firstSignedInAt", s.left_at as "leftAt", s.created_at as "createdAt",
            m.name as "managerName",
            coalesce((select json_agg(sr.role order by sr.role) from staff_role sr where sr.staff_id = s.id), '[]'::json) as roles,
            (select count(*) from staff x where x.manager_id = s.id and x.left_at is null)::int as "directReports",
            (select count(*) from asset a where a.holder_staff_id = s.id and a.status = 'assigned')::int as "assetsHeld",
            (select count(*) from request r where r.current_reviewer_id = s.id and r.status = 'under_review')::int as "pendingReviews"
       from staff s
       left join staff m on m.id = s.manager_id
      order by s.left_at nulls first, s.name`,
  );

  const teams = await query<any>(
    `with recursive chain as (
       select s.id as manager_id, s.id as member_id, 0 as depth from staff s
       union all
       select c.manager_id, s.id, c.depth + 1 from staff s join chain c on s.manager_id = c.member_id
        where c.depth < 25
     )
     select c.manager_id as "managerId", count(distinct c.member_id)::int as "teamSize"
       from chain c where c.depth > 0 group by c.manager_id`,
  );

  const staff = rows.map((r) => ({
    ...r,
    roles: r.roles as Role[],
    createdAt: iso(r.createdAt),
    firstSignedInAt: iso(r.firstSignedInAt),
    leftAt: iso(r.leftAt),
    teamSize: 0,
  }));
  for (const s of staff) {
    s.teamSize = Number(teams.find((t) => t.managerId === s.id)?.teamSize ?? 0);
  }

  return { rows: staff, totals: { total: staff.filter((s) => !s.leftAt).length, left: staff.filter((s) => !!s.leftAt).length } };
}

export async function staffDetail(staffId: string) {
  const staff = await one<any>(
    `select s.id, s.name, s.email, s.job_title as "jobTitle", s.manager_id as "managerId",
            s.first_signed_in_at as "firstSignedInAt", s.left_at as "leftAt", s.created_at as "createdAt",
            m.name as "managerName",
            coalesce((select json_agg(sr.role order by sr.role) from staff_role sr where sr.staff_id = s.id), '[]'::json) as roles
       from staff s left join staff m on m.id = s.manager_id where s.id = $1`,
    [staffId],
  );
  if (!staff) throw new ApiError(404, 'Staff member not found.');

  const assets = await query<any>(
    `select a.id, a.ref, a.serial_number as "serialNumber", a.status, at.name as "assetTypeName",
            a.registered_at as "registeredAt"
       from asset a join asset_type at on at.id = a.asset_type_id
      where a.holder_staff_id = $1 order by at.name`,
    [staffId],
  );

  const requests = await query<any>(
    `select r.id, r.ref, r.status, r.priority, r.raised_at as "raisedAt",
            case when r.raised_for = $1 then 'for' else 'by' end as relation
       from request r where r.raised_by = $1 or r.raised_for = $1
      order by r.raised_at desc limit 50`,
    [staffId],
  );

  const team = await query<any>(
    `with recursive reports as (
       select s.id, s.name, s.email, s.job_title as "jobTitle", s.manager_id as "managerId", 1 as depth
         from staff s where s.manager_id = $1
       union all
       select s.id, s.name, s.email, s.job_title as "jobTitle", s.manager_id as "managerId", r.depth + 1
         from staff s join reports r on s.manager_id = r.id
     ) select distinct id, name, email, "jobTitle", "managerId", depth from reports order by depth, name`,
    [staffId],
  );

  const blockers = await departureBlockers(staffId);

  return {
    staff: {
      ...staff,
      roles: staff.roles as Role[],
      firstSignedInAt: iso(staff.firstSignedInAt),
      leftAt: iso(staff.leftAt),
      createdAt: iso(staff.createdAt),
    },
    assets: assets.map((a) => ({ ...a, registeredAt: iso(a.registeredAt) })),
    requests: requests.map((r) => ({ ...r, raisedAt: iso(r.raisedAt) })),
    team,
    blockers,
  };
}

export async function departureBlockers(staffId: string) {
  const reports = await query<{ id: string; name: string }>(
    `select id, name from staff where manager_id = $1 and left_at is null`,
    [staffId],
  );
  const assets = await query<{ id: string; ref: string }>(
    `select id, ref from asset where holder_staff_id = $1 and status = 'assigned'`,
    [staffId],
  );
  const reviews = await query<{ id: string; ref: string }>(
    `select id, ref from request where current_reviewer_id = $1 and status = 'under_review'`,
    [staffId],
  );
  const blockers: { kind: string; message: string }[] = [];
  if (reports.length) {
    blockers.push({
      kind: 'reports',
      message: `${reports.length} direct report(s) must be reassigned first (${reports.map((r) => r.name).join(', ')}).`,
    });
  }
  if (assets.length) {
    blockers.push({
      kind: 'assets',
      message: `${assets.length} asset(s) are still held (${assets.map((a) => a.ref).join(', ')}). Return or transfer them first.`,
    });
  }
  if (reviews.length) {
    blockers.push({
      kind: 'reviews',
      message: `${reviews.length} request(s) are waiting for this person's review (${reviews.map((r) => r.ref).join(', ')}).`,
    });
  }
  return blockers;
}

const staffSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.'),
  email: z.string().trim().email('Enter a valid email address.'),
  jobTitle: z.string().trim().max(120).optional().nullable(),
  managerId: z.string().uuid().nullable().optional(),
  roles: z.array(z.enum(['team_lead', 'line_manager', 'stock_manager', 'financial_executive', 'administrator'])).default([]),
  password: z.string().min(8, 'Password must be at least 8 characters.').optional(),
});

export async function createStaff(user: CurrentUser, body: unknown) {
  const input = parseBody(staffSchema, body);
  const existing = await one(`select 1 from staff where lower(email) = lower($1)`, [input.email]);
  if (existing) throw new ApiError(409, 'A staff member with that email already exists.');
  if (input.managerId) {
    const manager = await one<{ left_at: string | null }>(`select left_at from staff where id = $1`, [input.managerId]);
    if (!manager) throw new ApiError(400, 'Choose a valid manager.');
    if (manager.left_at) throw new ApiError(400, 'A staff member who has left cannot be a manager.');
  }
  const id = uid();
  const password = input.password ?? 'Password123!';
  await withTransaction(async (tx) => {
    await tx.query(
      `insert into staff (id, name, email, password_hash, job_title, manager_id) values ($1,$2,$3,$4,$5,$6)`,
      [id, input.name, input.email.toLowerCase(), hashPassword(password), input.jobTitle ?? null, input.managerId ?? null],
    );
    for (const role of input.roles ?? []) {
      await tx.query(`insert into staff_role (staff_id, role) values ($1,$2)`, [id, role]);
    }
    if (input.managerId) {
      await tx.query(
        `insert into staff_role (staff_id, role) values ($1,'team_lead') on conflict do nothing`,
        [input.managerId],
      );
    }
  });
  return { id, temporaryPassword: input.password ? null : password };
}

export async function updateStaff(user: CurrentUser, staffId: string, body: unknown) {
  const input = parseBody(staffSchema.partial(), body);
  const staff = await one<{ id: string; left_at: string | null }>(`select id, left_at from staff where id = $1`, [staffId]);
  if (!staff) throw new ApiError(404, 'Staff member not found.');
  if (input.managerId === staffId) throw new ApiError(400, 'A staff member cannot report to themselves.');
  if (input.managerId) {
    const manager = await one<{ left_at: string | null }>(`select left_at from staff where id = $1`, [input.managerId]);
    if (!manager) throw new ApiError(400, 'Choose a valid manager.');
    if (manager.left_at) throw new ApiError(400, 'A staff member who has left cannot be a manager.');
    // prevent cycles
    const cycle = await one(
      `with recursive chain as (
         select id, manager_id from staff where id = $1
         union all select s.id, s.manager_id from staff s join chain c on s.id = c.manager_id
       ) select 1 from chain where id = $2`,
      [input.managerId, staffId],
    );
    if (cycle) throw new ApiError(400, 'That manager is already below this staff member in the reporting line.');
  }

  await withTransaction(async (tx) => {
    if (input.name !== undefined) await tx.query(`update staff set name = $2 where id = $1`, [staffId, input.name]);
    if (input.email !== undefined)
      await tx.query(`update staff set email = $2 where id = $1`, [staffId, input.email.toLowerCase()]);
    if (input.jobTitle !== undefined) await tx.query(`update staff set job_title = $2 where id = $1`, [staffId, input.jobTitle]);
    if (input.managerId !== undefined) {
      await tx.query(`update staff set manager_id = $2 where id = $1`, [staffId, input.managerId]);
      if (input.managerId) {
        await tx.query(`insert into staff_role (staff_id, role) values ($1,'team_lead') on conflict do nothing`, [
          input.managerId,
        ]);
      }
    }
    const nextRoles = input.roles;
    if (nextRoles) {
      await tx.query(`delete from staff_role where staff_id = $1`, [staffId]);
      for (const role of nextRoles)
        await tx.query(`insert into staff_role (staff_id, role) values ($1,$2)`, [staffId, role]);
    }
  });
  return staffDetail(staffId);
}

export async function resetPassword(staffId: string, body: unknown) {
  const input = parseBody(z.object({ password: z.string().min(8, 'Password must be at least 8 characters.') }), body);
  await query(`update staff set password_hash = $2 where id = $1`, [staffId, hashPassword(input.password)]);
  await query(`delete from session where staff_id = $1`, [staffId]);
  return { ok: true };
}

export async function markLeft(user: CurrentUser, staffId: string) {
  const staff = await one<{ id: string; name: string; left_at: string | null }>(
    `select id, name, left_at from staff where id = $1`,
    [staffId],
  );
  if (!staff) throw new ApiError(404, 'Staff member not found.');
  if (staff.left_at) throw new ApiError(400, 'This staff member has already been marked as left.');
  const blockers = await departureBlockers(staffId);
  if (blockers.length) {
    throw new ApiError(400, `Cannot mark ${staff.name} as left. ${blockers.map((b) => b.message).join(' ')}`);
  }

  const outstanding = await query<{ id: string; ref: string; status: string }>(
    `select id, ref, status from request
      where raised_for = $1 and status in ('raised','under_review','in_progress')`,
    [staffId],
  );

  await withTransaction(async (tx) => {
    await tx.query(`update staff set left_at = now() where id = $1`, [staffId]);
    await tx.query(`delete from session where staff_id = $1`, [staffId]);
    for (const request of outstanding) {
      await tx.query(
        `update request set status = 'cancelled', current_reviewer_id = null where id = $1`,
        [request.id],
      );
      await tx.query(
        `update request_item set status = 'closed', closed_reason = 'cancelled', review_due_at = null, updated_at = now()
          where request_line_id in (select id from request_line where request_id = $1)
            and status not in ('issued','closed')`,
        [request.id],
      );
      // Items already bought go back into stock rather than being lost.
      const bought = await tx.query<{ id: string }>(
        `select a.id from asset a
           join request_item ri on ri.id = a.request_item_id
           join request_line rl on rl.id = ri.request_line_id
          where rl.request_id = $1 and a.status = 'available'`,
        [request.id],
      );
      for (const asset of bought) {
        await tx.query(
          `insert into asset_history (id, asset_id, event, by_staff_id, note)
           values ($1,$2,'AssetReturned',$3,$4)`,
          [uid(), asset.id, user.id, 'Returned to stock: the request was cancelled when the staff member left.'],
        );
      }
      await tx.query(
        `insert into request_history (id, request_id, event, by_staff_id, note)
         values ($1,$2,'RequestCancelled',$3,$4)`,
        [uid(), request.id, user.id, 'Cancelled automatically: the staff member it was raised for has left.'],
      );
    }
  });

  return { cancelledRequests: outstanding.length };
}

export async function rooms() {
  const rows = await query<any>(
    `select r.id, r.name, r.building, r.floor, r.active, r.created_at as "createdAt",
            (select count(*) from asset a where a.room_id = r.id and a.status = 'assigned')::int as "assetCount"
       from room r order by r.active desc, r.name`,
  );
  return { rows: rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) })) };
}

const roomSchema = z.object({
  name: z.string().trim().min(1, 'Room name is required.'),
  building: z.string().trim().max(120).optional().nullable(),
  floor: z.string().trim().max(60).optional().nullable(),
  active: z.boolean().optional(),
});

export async function createRoom(body: unknown) {
  const input = parseBody(roomSchema, body);
  const id = uid();
  await query(`insert into room (id, name, building, floor) values ($1,$2,$3,$4)`, [
    id,
    input.name,
    input.building ?? null,
    input.floor ?? null,
  ]);
  return { id };
}

export async function updateRoom(roomId: string, body: unknown) {
  const input = parseBody(roomSchema.partial(), body);
  await query(
    `update room set name = coalesce($2, name), building = coalesce($3, building),
            floor = coalesce($4, floor), active = coalesce($5, active) where id = $1`,
    [roomId, input.name ?? null, input.building ?? null, input.floor ?? null, input.active ?? null],
  );
  return { ok: true };
}

const assetTypeSchema = z.object({
  name: z.string().trim().min(1, 'Asset type name is required.'),
  custodyKind: z.enum(['person', 'location']),
  category: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
});

export async function createAssetType(body: unknown) {
  const input = parseBody(assetTypeSchema, body);
  const id = uid();
  await query(
    `insert into asset_type (id, name, custody_kind, category, description) values ($1,$2,$3,$4,$5)`,
    [id, input.name, input.custodyKind, input.category || 'General', input.description ?? null],
  );
  return { id };
}

export async function updateAssetType(typeId: string, body: unknown) {
  const input = parseBody(assetTypeSchema.partial(), body);
  await query(
    `update asset_type set name = coalesce($2, name), custody_kind = coalesce($3, custody_kind),
            category = coalesce($4, category), description = coalesce($5, description),
            active = coalesce($6, active)
      where id = $1`,
    [typeId, input.name ?? null, input.custodyKind ?? null, input.category ?? null, input.description ?? null, input.active ?? null],
  );
  return { ok: true };
}

export async function organisationOverview() {
  const staff = await query<any>(
    `select s.id, s.name, s.email, s.job_title as "jobTitle", s.manager_id as "managerId",
            s.left_at as "leftAt", m.name as "managerName",
            coalesce((select json_agg(sr.role) from staff_role sr where sr.staff_id = s.id), '[]'::json) as roles
       from staff s left join staff m on m.id = s.manager_id
      order by s.name`,
  );

  const teams = await query<any>(
    `with recursive chain as (
       select s.id as manager_id, s.id as member_id, 0 as depth from staff s
       union all
       select c.manager_id, s.id, c.depth + 1 from staff s join chain c on s.manager_id = c.member_id
        where c.depth < 25
     )
     select c.manager_id as "managerId", count(distinct c.member_id)::int as "teamSize"
       from chain c where c.depth > 0 group by c.manager_id`,
  );

  const members = await query<any>(
    `with recursive chain as (
       select s.id as manager_id, s.id as member_id, s.name as member_name, 1 as depth from staff s
       union all
       select c.manager_id, s.id, s.name, c.depth + 1 from staff s join chain c on s.manager_id = c.member_id
        where c.depth < 25
     )
     select manager_id as "managerId", member_id as "memberId", member_name as "memberName", depth
       from chain where depth > 0 order by depth, member_name`,
  );

  const isManager = new Set<string>();
  for (const s of staff) if (s.managerId) isManager.add(String(s.managerId));

  const rows = staff.map((s) => ({
    ...s,
    roles: s.roles as Role[],
    leftAt: iso(s.leftAt),
    teamSize: Number(teams.find((t) => t.managerId === s.id)?.teamSize ?? 0),
    hasManager: !!s.managerId,
    isLineManager: (s.roles as Role[]).includes('line_manager'),
    team: members
      .filter((m) => m.managerId === s.id)
      .map((m) => ({ id: m.memberId, name: m.memberName, depth: m.depth })),
  }));

  return {
    rows,
    lineManagers: rows.filter((r) => (r.roles as Role[]).includes('line_manager')),
    noManager: rows.filter((r) => !r.managerId && !r.leftAt),
    totalManagers: isManager.size,
    roles: ALL_ROLES,
  };
}
