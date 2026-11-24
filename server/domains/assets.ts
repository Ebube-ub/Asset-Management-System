import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError, parseBody } from '../lib/http.js';
import { loadUser, type CurrentUser } from '../lib/auth.js';
import { addAssetHistory, addRequestHistory, iso, nextAssetRef, recomputeRequestStatus, uid } from '../lib/repo.js';

export type AssetFilters = {
  q?: string;
  status?: string;
  assetTypeId?: string;
  holderId?: string;
  roomId?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  scope?: 'all' | 'mine';
};

export async function listAssets(user: CurrentUser, filters: AssetFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, filters.pageSize ?? 10));
  const where: string[] = [];
  const params: unknown[] = [];

  const onlyMine =
    filters.scope === 'mine' ||
    !user.roles.some((r) =>
      ['administrator', 'stock_manager', 'financial_executive', 'line_manager', 'team_lead'].includes(r),
    );
  if (onlyMine) {
    params.push(user.id);
    where.push(`a.holder_staff_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`a.status = $${params.length}`);
  }
  if (filters.assetTypeId) {
    params.push(filters.assetTypeId);
    where.push(`a.asset_type_id = $${params.length}`);
  }
  if (filters.holderId) {
    params.push(filters.holderId);
    where.push(`a.holder_staff_id = $${params.length}`);
  }
  if (filters.roomId) {
    params.push(filters.roomId);
    where.push(`a.room_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(a.ref ilike $${params.length} or a.serial_number ilike $${params.length}
      or at.name ilike $${params.length} or s.name ilike $${params.length} or rm.name ilike $${params.length})`);
  }
  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const sortable: Record<string, string> = {
    ref: 'a.ref',
    name: 'at.name',
    status: 'a.status',
    registeredAt: 'a.registered_at',
  };
  const sort = sortable[filters.sort ?? 'registeredAt'] ?? 'a.registered_at';
  const dir = filters.dir === 'asc' ? 'asc' : 'desc';

  const totalRow = await one<{ total: string }>(
    `select count(*)::text as total from asset a
       join asset_type at on at.id = a.asset_type_id
       left join staff s on s.id = a.holder_staff_id
       left join room rm on rm.id = a.room_id
       ${whereSql}`,
    params,
  );

  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const rows = await query<Record<string, unknown>>(
    `select a.id, a.ref, a.serial_number as "serialNumber", a.condition, a.status,
            a.registered_at as "registeredAt",
            at.name as "assetTypeName", at.custody_kind as "custodyKind", at.id as "assetTypeId",
            s.name as "holderName", s.id as "holderId", rm.name as "roomName", rm.id as "roomId",
            (select d.id from disposal d where d.asset_id = a.id and d.status in ('pending','approved') limit 1) as "disposalId",
            (select count(*) from asset_movement m where m.asset_id = a.id and m.status = 'pending')::int as "pendingMovements"
       from asset a
       join asset_type at on at.id = a.asset_type_id
       left join staff s on s.id = a.holder_staff_id
       left join room rm on rm.id = a.room_id
       ${whereSql}
      order by ${sort} ${dir}
      limit $${listParams.length - 1} offset $${listParams.length}`,
    listParams,
  );

  return {
    rows: rows.map((r) => ({ ...r, registeredAt: iso(r.registeredAt) })),
    total: Number(totalRow?.total ?? 0),
    page,
    pageSize,
  };
}

export async function getAsset(assetId: string) {
  const asset = await one<Record<string, unknown>>(
    `select a.id, a.ref, a.serial_number as "serialNumber", a.condition, a.status, a.notes,
            a.registered_at as "registeredAt", a.asset_type_id as "assetTypeId",
            at.name as "assetTypeName", at.custody_kind as "custodyKind", at.category,
            s.name as "holderName", s.id as "holderId", s.email as "holderEmail",
            rm.name as "roomName", rm.id as "roomId",
            p.vendor_name as "purchaseVendor", p.cost::float8 as "purchaseCost", p.recorded_at as "purchaseDate",
            p.receipt_url as "receiptUrl", p.receipt_name as "receiptName",
            r.ref as "requestRef", r.id as "requestId",
            rs.name as "registeredByName"
       from asset a
       join asset_type at on at.id = a.asset_type_id
       left join staff s on s.id = a.holder_staff_id
       left join room rm on rm.id = a.room_id
       left join purchase p on p.id = a.purchase_id
       left join request_item ri on ri.id = a.request_item_id
       left join request_line rl on rl.id = ri.request_line_id
       left join request r on r.id = rl.request_id
       left join staff rs on rs.id = a.registered_by
      where a.id = $1`,
    [assetId],
  );
  if (!asset) throw new ApiError(404, 'Asset not found.');

  const history = await query<Record<string, unknown>>(
    `select h.id, h.event, h.from_holder as "fromHolder", h.to_holder as "toHolder", h.at, h.note,
            s.name as "byName"
       from asset_history h left join staff s on s.id = h.by_staff_id
      where h.asset_id = $1 order by h.at desc, h.id`,
    [assetId],
  );

  const movements = await query<Record<string, unknown>>(
    `select m.id, m.kind, m.status, m.requested_at as "requestedAt", m.confirmed_at as "confirmedAt", m.note,
            rb.name as "requestedByName", cb.name as "confirmedByName",
            ts.name as "toStaffName", tr.name as "toRoomName"
       from asset_movement m
       left join staff rb on rb.id = m.requested_by
       left join staff cb on cb.id = m.confirmed_by
       left join staff ts on ts.id = m.to_staff_id
       left join room tr on tr.id = m.to_room_id
      where m.asset_id = $1 order by m.requested_at desc`,
    [assetId],
  );

  const disposal = await one<Record<string, unknown>>(
    `select d.id, d.method, d.reason, d.status, d.proposed_at as "proposedAt", d.decided_at as "decidedAt",
            d.decision_note as "decisionNote", d.proceeds::float8 as proceeds, d.buyer, d.completed_at as "completedAt",
            p.name as "proposedByName", dec.name as "decidedByName"
       from disposal d
       left join staff p on p.id = d.proposed_by
       left join staff dec on dec.id = d.decided_by
      where d.asset_id = $1 order by d.proposed_at desc limit 1`,
    [assetId],
  );

  return {
    asset: { ...asset, registeredAt: iso(asset.registeredAt), purchaseDate: iso(asset.purchaseDate) },
    history: history.map((h) => ({ ...h, at: iso(h.at) })),
    movements: movements.map((m) => ({ ...m, requestedAt: iso(m.requestedAt), confirmedAt: iso(m.confirmedAt) })),
    disposal: disposal
      ? {
          ...disposal,
          proposedAt: iso(disposal.proposedAt),
          decidedAt: iso(disposal.decidedAt),
          completedAt: iso(disposal.completedAt),
        }
      : null,
  };
}

export const registerAssetSchema = z.object({
  assetTypeId: z.string().uuid(),
  serialNumber: z.string().trim().max(100).optional().nullable(),
  condition: z.enum(['new', 'good', 'fair', 'poor']).default('good'),
  holderStaffId: z.string().uuid().optional().nullable(),
  roomId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/** FR21: register an asset found in the store, with no request or purchase behind it. */
export async function registerAsset(user: CurrentUser, body: unknown) {
  const input = parseBody(registerAssetSchema, body);
  const type = await one<{ id: string; name: string; custody_kind: string }>(
    `select id, name, custody_kind from asset_type where id = $1`,
    [input.assetTypeId],
  );
  if (!type) throw new ApiError(400, 'Choose a valid asset type.');
  if (type.custody_kind === 'person' && input.roomId) {
    throw new ApiError(400, `${type.name} is held by a person, so it cannot be placed in a room.`);
  }
  if (type.custody_kind === 'location' && input.holderStaffId) {
    throw new ApiError(400, `${type.name} is held by location, so it cannot be assigned to a person.`);
  }
  if (input.holderStaffId && input.roomId) throw new ApiError(400, 'An asset is held by a person or a room, not both.');

  const id = uid();
  const ref = await nextAssetRef();
  const assigned = !!(input.holderStaffId || input.roomId);

  await withTransaction(async (tx) => {
    await tx.query(
      `insert into asset (id, ref, asset_type_id, serial_number, condition, status, holder_staff_id, room_id, registered_by, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        ref,
        input.assetTypeId,
        input.serialNumber ?? null,
        input.condition,
        assigned ? 'assigned' : 'available',
        assigned && type.custody_kind === 'person' ? input.holderStaffId : null,
        assigned && type.custody_kind === 'location' ? input.roomId : null,
        user.id,
        input.notes ?? null,
      ],
    );
    const holderName = input.holderStaffId
      ? (await tx.one<{ name: string }>(`select name from staff where id = $1`, [input.holderStaffId]))?.name
      : input.roomId
        ? (await tx.one<{ name: string }>(`select name from room where id = $1`, [input.roomId]))?.name
        : null;
    await tx.query(
      `insert into asset_history (id, asset_id, event, to_holder, by_staff_id, note)
       values ($1,$2,'AssetRegistered',$3,$4,$5)`,
      [uid(), id, holderName ?? null, user.id, 'Registered existing asset found in the store.'],
    );
  });

  return { id, ref };
}

const destinationSchema = z.object({
  holderStaffId: z.string().uuid().optional().nullable(),
  roomId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

/** Returns a destination name and validates it against the type's custody setting. */
async function resolveDestination(
  custodyKind: string,
  typeName: string,
  input: z.infer<typeof destinationSchema>,
): Promise<{ holderId: string | null; roomId: string | null; label: string }> {
  if (custodyKind === 'person') {
    if (!input.holderStaffId) throw new ApiError(400, `${typeName} is assigned to a person — choose a staff member.`);
    const staff = await one<{ id: string; name: string; left_at: string | null }>(
      `select id, name, left_at from staff where id = $1`,
      [input.holderStaffId],
    );
    if (!staff) throw new ApiError(400, 'Choose a valid staff member.');
    if (staff.left_at) throw new ApiError(400, 'That staff member has left the organisation.');
    return { holderId: staff.id, roomId: null, label: staff.name };
  }
  if (!input.roomId) throw new ApiError(400, `${typeName} is assigned to a location — choose a room.`);
  const room = await one<{ id: string; name: string; active: boolean }>(`select id, name, active from room where id = $1`, [
    input.roomId,
  ]);
  if (!room || !room.active) throw new ApiError(400, 'Choose a valid, active room.');
  return { holderId: null, roomId: room.id, label: room.name };
}

function currentHolderLabel(asset: Record<string, unknown>): string | null {
  return (asset.holderName as string) ?? (asset.roomName as string) ?? null;
}

export async function assignAsset(user: CurrentUser, assetId: string, body: unknown) {
  const input = parseBody(destinationSchema, body);
  const asset = await one<Record<string, unknown>>(
    `select a.id, a.ref, a.status, a.asset_type_id as "assetTypeId", at.name as "assetTypeName",
            at.custody_kind as "custodyKind"
       from asset a join asset_type at on at.id = a.asset_type_id where a.id = $1`,
    [assetId],
  );
  if (!asset) throw new ApiError(404, 'Asset not found.');
  if (asset.status === 'disposed') throw new ApiError(400, 'A disposed asset cannot be assigned.');
  if (asset.status === 'assigned') throw new ApiError(409, 'This asset is already assigned. Transfer it instead.');
  if (asset.status === 'awaiting_disposal') throw new ApiError(400, 'This asset is awaiting disposal approval.');
  const destination = await resolveDestination(String(asset.custodyKind), String(asset.assetTypeName), input);

  await query(
    `update asset set status = 'assigned', holder_staff_id = $2, room_id = $3 where id = $1`,
    [assetId, destination.holderId, destination.roomId],
  );
  await addAssetHistory({
    assetId,
    event: 'AssetAssigned',
    toHolder: destination.label,
    byStaffId: user.id,
    note: input.note || 'Assigned from stock.',
  });
  return { ok: true };
}

export const movementSchema = z.object({
  holderStaffId: z.string().uuid().optional().nullable(),
  roomId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

/** A transfer or return is only effective once the stock manager confirms it. */
export async function requestMovement(
  user: CurrentUser,
  assetId: string,
  kind: 'transfer' | 'return',
  body: unknown,
) {
  const input = parseBody(movementSchema, body ?? {});
  const asset = await one<Record<string, unknown>>(
    `select a.id, a.ref, a.status, a.holder_staff_id as "holderId", a.room_id as "roomId",
            at.name as "assetTypeName", at.custody_kind as "custodyKind",
            s.name as "holderName", rm.name as "roomName"
       from asset a join asset_type at on at.id = a.asset_type_id
       left join staff s on s.id = a.holder_staff_id
       left join room rm on rm.id = a.room_id
      where a.id = $1`,
    [assetId],
  );
  if (!asset) throw new ApiError(404, 'Asset not found.');
  if (asset.status !== 'assigned') throw new ApiError(400, 'Only an assigned asset can be transferred or returned.');

  const isStockManager = user.roles.includes('stock_manager') || user.roles.includes('administrator');
  const isHolder = asset.holderId === user.id;

  let destination: { holderId: string | null; roomId: string | null; label: string } | null = null;
  if (kind === 'transfer') {
    destination = await resolveDestination(String(asset.custodyKind), String(asset.assetTypeName), input);
    if (destination.holderId && destination.holderId === asset.holderId && destination.roomId === asset.roomId) {
      throw new ApiError(400, 'That is the current holder.');
    }
  }

  const movementId = uid();
  const autoConfirm = isStockManager;

  await withTransaction(async (tx) => {
    await tx.query(
      `insert into asset_movement (id, asset_id, kind, to_staff_id, to_room_id, requested_by, status, confirmed_by, confirmed_at, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        movementId,
        assetId,
        kind,
        destination?.holderId ?? null,
        destination?.roomId ?? null,
        user.id,
        autoConfirm ? 'confirmed' : 'pending',
        autoConfirm ? user.id : null,
        autoConfirm ? new Date() : null,
        input.note ?? null,
      ],
    );
    if (autoConfirm) {
      await tx.query(`update asset set status = 'available', holder_staff_id = null, room_id = null where id = $1`, [assetId]);
      if (kind === 'transfer' && destination) {
        await tx.query(`update asset set status = 'assigned', holder_staff_id = $2, room_id = $3 where id = $1`, [
          assetId,
          destination.holderId,
          destination.roomId,
        ]);
      }
      await tx.query(
        `insert into asset_history (id, asset_id, event, from_holder, to_holder, by_staff_id, note)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          uid(),
          assetId,
          kind === 'transfer' ? 'AssetTransferred' : 'AssetReturned',
          currentHolderLabel(asset),
          destination?.label ?? null,
          user.id,
          (input.note ? input.note + ' ' : '') + 'Confirmed by the stock manager.',
        ],
      );
    }
  });

  if (!autoConfirm) {
    await query(
      `insert into asset_history (id, asset_id, event, from_holder, to_holder, by_staff_id, note)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        uid(),
        assetId,
        kind === 'transfer' ? 'TransferRequested' : 'ReturnRequested',
        currentHolderLabel(asset),
        destination?.label ?? 'Stock',
        user.id,
        (input.note ? input.note + ' ' : '') + 'Awaiting stock manager confirmation.',
      ],
    );
  }

  return { id: movementId, status: autoConfirm ? 'confirmed' : 'pending' };
}

export async function movements(user: CurrentUser, kind: 'transfer' | 'return' | 'all') {
  const params: unknown[] = [];
  let kindFilter = '';
  if (kind !== 'all') {
    params.push(kind);
    kindFilter = `and m.kind = $${params.length}`;
  }
  const rows = await query<Record<string, unknown>>(
    `select m.id, m.kind, m.status, m.requested_at as "requestedAt", m.confirmed_at as "confirmedAt", m.note,
            rb.name as "requestedByName", cb.name as "confirmedByName",
            a.id as "assetId", a.ref, at.name as "assetTypeName",
            a.holder_staff_id as "currentHolderId",
            ts.name as "toStaffName", tr.name as "toRoomName",
            cs.name as "currentHolderName", cr.name as "currentRoomName"
       from asset_movement m
       join asset a on a.id = m.asset_id
       join asset_type at on at.id = a.asset_type_id
       left join staff rb on rb.id = m.requested_by
       left join staff cb on cb.id = m.confirmed_by
       left join staff ts on ts.id = m.to_staff_id
       left join room tr on tr.id = m.to_room_id
       left join staff cs on cs.id = a.holder_staff_id
       left join room cr on cr.id = a.room_id
      where 1=1 ${kindFilter}
      order by (m.status = 'pending') desc, m.requested_at desc
      limit 200`,
    params,
  );
  return {
    rows: rows.map((r) => ({
      ...r,
      requestedAt: iso(r.requestedAt),
      confirmedAt: iso(r.confirmedAt),
      canConfirm:
        r.status === 'pending' &&
        (user.roles.includes('stock_manager') || user.roles.includes('administrator')),
    })),
  };
}

export async function confirmMovement(user: CurrentUser, movementId: string, action: 'confirm' | 'reject') {
  const movement = await one<Record<string, unknown>>(
    `select m.*, a.ref, a.status as "assetStatus", a.holder_staff_id as "holderId", a.room_id as "roomId",
            at.name as "assetTypeName", at.custody_kind as "custodyKind",
            s.name as "holderName", rm.name as "roomName"
       from asset_movement m
       join asset a on a.id = m.asset_id
       join asset_type at on at.id = a.asset_type_id
       left join staff s on s.id = a.holder_staff_id
       left join room rm on rm.id = a.room_id
      where m.id = $1`,
    [movementId],
  );
  if (!movement) throw new ApiError(404, 'Movement not found.');
  if (movement.status !== 'pending') throw new ApiError(400, 'This movement has already been decided.');

  let toLabel: string | null = null;
  if (movement.to_staff_id) {
    toLabel = (await one<{ name: string }>(`select name from staff where id = $1`, [movement.to_staff_id]))?.name ?? null;
  } else if (movement.to_room_id) {
    toLabel = (await one<{ name: string }>(`select name from room where id = $1`, [movement.to_room_id]))?.name ?? null;
  }

  if (action === 'reject') {
    await query(
      `update asset_movement set status = 'rejected', confirmed_by = $2, confirmed_at = now() where id = $1`,
      [movementId, user.id],
    );
    await addAssetHistory({
      assetId: String(movement.asset_id),
      event: movement.kind === 'transfer' ? 'TransferRejected' : 'ReturnRejected',
      fromHolder: currentHolderLabel(movement),
      byStaffId: user.id,
      note: 'The stock manager rejected this movement.',
    });
    return { ok: true };
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `update asset_movement set status = 'confirmed', confirmed_by = $2, confirmed_at = now() where id = $1`,
      [movementId, user.id],
    );
    await tx.query(`update asset set status = 'available', holder_staff_id = null, room_id = null where id = $1`, [
      movement.asset_id,
    ]);
    if (movement.kind === 'transfer') {
      if (movement.custodyKind === 'person') {
        if (!movement.to_staff_id) throw new ApiError(400, 'The transfer has no destination.');
        await tx.query(`update asset set status = 'assigned', holder_staff_id = $2 where id = $1`, [
          movement.asset_id,
          movement.to_staff_id,
        ]);
      } else {
        if (!movement.to_room_id) throw new ApiError(400, 'The transfer has no destination room.');
        await tx.query(`update asset set status = 'assigned', room_id = $2 where id = $1`, [
          movement.asset_id,
          movement.to_room_id,
        ]);
      }
    }
    await tx.query(
      `insert into asset_history (id, asset_id, event, from_holder, to_holder, by_staff_id, note)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        uid(),
        movement.asset_id,
        movement.kind === 'transfer' ? 'AssetTransferred' : 'AssetReturned',
        currentHolderLabel(movement),
        movement.kind === 'transfer' ? toLabel : null,
        user.id,
        movement.note ? String(movement.note) : 'Confirmed by the stock manager.',
      ],
    );
  });
  return { ok: true };
}

export async function assetTypesList(includeInactive = false) {
  const rows = await query<Record<string, unknown>>(
    `select at.id, at.name, at.custody_kind as "custodyKind", at.category, at.description, at.active,
            at.created_at as "createdAt",
            (select count(*) from asset a where a.asset_type_id = at.id and a.status = 'available')::int as "availableCount",
            (select count(*) from asset a where a.asset_type_id = at.id and a.status = 'assigned')::int as "assignedCount",
            (select count(*) from asset a where a.asset_type_id = at.id)::int as "totalCount"
       from asset_type at
      ${includeInactive ? '' : 'where at.active = true'}
      order by at.name`,
  );
  return { rows: rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) })) };
}
