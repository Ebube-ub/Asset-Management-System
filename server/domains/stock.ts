import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError, parseBody } from '../lib/http.js';
import type { CurrentUser } from '../lib/auth.js';
import { addAssetHistory, addRequestHistory, iso, recomputeRequestStatus, uid } from '../lib/repo.js';

const priorityOrder = `case r.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

export async function stockQueue() {
  const rows = await query<Record<string, unknown>>(
    `select rl.id as "lineId", r.id as "requestId", r.ref, r.priority, r.raised_at as "raisedAt",
            r.justification, rf.name as "raisedForName", rf.id as "raisedForId",
            at.id as "assetTypeId", at.name as "assetTypeName", at.custody_kind as "custodyKind",
            rm.name as "roomName", rm.id as "roomId",
            rl.quantity,
            (select count(*) from request_item ri where ri.request_line_id = rl.id and ri.status = 'requested')::int as "requestedCount",
            (select count(*) from request_item ri where ri.request_line_id = rl.id and ri.status = 'purchased')::int as "purchasedCount",
            (select count(*) from asset a where a.asset_type_id = rl.asset_type_id and a.status = 'available')::int as "availableCount"
       from request_line rl
       join request r on r.id = rl.request_id
       join asset_type at on at.id = rl.asset_type_id
       join staff rf on rf.id = r.raised_for
       left join room rm on rm.id = rl.recipient_room_id
      where r.status = 'in_progress'
        and exists (select 1 from request_item ri where ri.request_line_id = rl.id and ri.status in ('requested','purchased'))
      order by ${priorityOrder}, r.raised_at asc`,
  );

  const lineIds = rows.map((r) => String(r.lineId));
  const items = lineIds.length
    ? await query<Record<string, unknown>>(
        `select ri.id, ri.request_line_id as "lineId", ri.seq, ri.status,
                (select count(*) from request_item x where x.request_line_id = ri.request_line_id and x.seq <= ri.seq)::int as "position"
           from request_item ri
          where ri.request_line_id = any($1::uuid[]) and ri.status in ('requested','purchased')
          order by ri.request_line_id, ri.seq`,
        [lineIds],
      )
    : [];

  const available = rows.length
    ? await query<Record<string, unknown>>(
        `select a.id, a.ref, a.serial_number as "serialNumber", a.asset_type_id as "assetTypeId",
                a.condition, a.status
           from asset a
          where a.status = 'available' and a.asset_type_id = any($1::uuid[])
          order by a.registered_at asc`,
        [[...new Set(rows.map((r) => String(r.assetTypeId)))]],
      )
    : [];

  return {
    rows: rows.map((r) => ({
      ...r,
      raisedAt: iso(r.raisedAt),
      items: items.filter((i) => i.lineId === r.lineId),
      availableAssets: available.filter((a) => a.assetTypeId === r.assetTypeId),
    })),
  };
}

const issueSchema = z.object({
  assignments: z
    .array(z.object({ itemId: z.string().uuid(), assetId: z.string().uuid() }))
    .min(1, 'Choose the stock item to issue for each unit.'),
});

export async function issueItems(user: CurrentUser, lineId: string, body: unknown) {
  const input = parseBody(issueSchema, body);
  const line = await one<Record<string, unknown>>(
    `select rl.id, rl.asset_type_id as "assetTypeId", rl.recipient_room_id as "roomId",
            r.id as "requestId", r.ref, r.raised_for as "raisedFor", at.custody_kind as "custodyKind",
            at.name as "assetTypeName", rf.name as "recipientName", rm.name as "roomName"
       from request_line rl
       join request r on r.id = rl.request_id
       join asset_type at on at.id = rl.asset_type_id
       join staff rf on rf.id = r.raised_for
       left join room rm on rm.id = rl.recipient_room_id
      where rl.id = $1`,
    [lineId],
  );
  if (!line) throw new ApiError(404, 'Request line not found.');
  if (!['in_progress'].includes(String((await one<{ status: string }>(`select status from request where id = $1`, [line.requestId]))?.status))) {
    throw new ApiError(400, 'Only an in-progress request can be issued.');
  }

  const issued = await withTransaction(async (tx) => {
    let count = 0;
    for (const assignment of input.assignments) {
      const item = await tx.one<{ id: string; status: string; lineId: string; requestId: string }>(
        `select ri.id, ri.status, ri.request_line_id as "lineId", rl.request_id as "requestId"
           from request_item ri join request_line rl on rl.id = ri.request_line_id
          where ri.id = $1`,
        [assignment.itemId],
      );
      if (!item || item.lineId !== lineId) throw new ApiError(400, 'That item is not on this request line.');
      if (!['requested', 'purchased'].includes(item.status)) {
        throw new ApiError(409, 'That item has already been issued or closed.');
      }
      const asset = await tx.one<Record<string, unknown>>(
        `select id, ref, status, asset_type_id as "assetTypeId", serial_number as "serialNumber"
           from asset where id = $1 for update`,
        [assignment.assetId],
      );
      if (!asset) throw new ApiError(404, 'Asset not found.');
      if (asset.assetTypeId !== line.assetTypeId) throw new ApiError(400, 'That asset is a different asset type.');
      if (asset.status !== 'available') {
        throw new ApiError(
          409,
          `${asset.ref} is no longer available (${String(asset.status).replace('_', ' ')}). It goes back to the stock check.`,
        );
      }
      const holderId = line.custodyKind === 'person' ? String(line.raisedFor) : null;
      const roomId = line.custodyKind === 'location' ? String(line.roomId) : null;
      if (line.custodyKind === 'location' && !roomId) {
        throw new ApiError(400, 'This request line needs a room before it can be issued.');
      }
      await tx.query(
        `update asset set status = 'assigned', holder_staff_id = $2, room_id = $3, request_item_id = $4 where id = $1`,
        [assignment.assetId, holderId, roomId, item.id],
      );
      await tx.query(
        `update request_item set status = 'issued', issued_asset_id = $2, updated_at = now() where id = $1`,
        [item.id, assignment.assetId],
      );
      await tx.query(
        `insert into asset_history (id, asset_id, event, from_holder, to_holder, by_staff_id, note)
         values ($1,$2,'AssetAssigned',null,$3,$4,$5)`,
        [
          uid(),
          assignment.assetId,
          line.custodyKind === 'person' ? String(line.recipientName) : String(line.roomName),
          user.id,
          `Issued on ${line.ref}.`,
        ],
      );
      await tx.query(
        `insert into request_history (id, request_id, request_line_id, request_item_id, event, by_staff_id, note)
         values ($1,$2,$3,$4,'ItemIssued',$5,$6)`,
        [uid(), item.requestId, lineId, item.id, user.id, `Issued ${asset.ref} (${line.assetTypeName}).`],
      );
      count++;
    }
    return count;
  });

  await recomputeRequestStatus(String(line.requestId), user.id);
  return { issued: issued, requestId: line.requestId };
}

/** Move whatever is still requested on a line into the quotation workflow. */
export async function sendToQuotations(user: CurrentUser, lineId: string, itemIds?: string[]) {
  const line = await one<{ id: string; requestId: string; ref: string }>(
    `select rl.id, rl.request_id as "requestId", r.ref from request_line rl join request r on r.id = rl.request_id where rl.id = $1`,
    [lineId],
  );
  if (!line) throw new ApiError(404, 'Request line not found.');
  const params: unknown[] = [lineId];
  let filter = '';
  if (itemIds && itemIds.length) {
    params.push(itemIds);
    filter = ` and id = any($2::uuid[])`;
  }
  const rows = await query<{ id: string }>(
    `update request_item set status = 'awaiting_quotation', updated_at = now()
      where request_line_id = $1 and status = 'requested'${filter}
      returning id`,
    params,
  );
  if (!rows.length) throw new ApiError(400, 'No requested items are waiting for a quotation.');
  await addRequestHistory({
    requestId: line.requestId,
    lineId,
    event: 'StockChecked',
    byStaffId: user.id,
    note: `${rows.length} item(s) not available in stock — sent for vendor quotations.`,
  });
  await recomputeRequestStatus(line.requestId, user.id);
  return { moved: rows.length };
}

const closeSchema = z.object({
  reason: z.enum(['unavailable']).default('unavailable'),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function closeItem(user: CurrentUser, itemId: string, body: unknown) {
  const input = parseBody(closeSchema, body ?? {});
  const item = await one<Record<string, unknown>>(
    `select ri.id, ri.status, ri.request_line_id as "lineId", rl.request_id as "requestId"
       from request_item ri join request_line rl on rl.id = ri.request_line_id where ri.id = $1`,
    [itemId],
  );
  if (!item) throw new ApiError(404, 'Item not found.');
  if (!['approved', 'awaiting_quotation'].includes(String(item.status))) {
    throw new ApiError(400, 'Only an approved item that cannot be sourced can be closed as unavailable.');
  }
  await query(
    `update request_item set status = 'closed', closed_reason = 'unavailable', updated_at = now() where id = $1`,
    [itemId],
  );
  await addRequestHistory({
    requestId: String(item.requestId),
    lineId: String(item.lineId),
    itemId,
    event: 'ItemClosed',
    byStaffId: user.id,
    note: input.note || 'Closed as unavailable — no vendor could supply this item.',
  });
  await recomputeRequestStatus(String(item.requestId), user.id);
  return { ok: true };
}

/** While parked, the stock manager can send an item back for new quotes. */
export async function requoteItem(user: CurrentUser, itemId: string) {
  const item = await one<Record<string, unknown>>(
    `select ri.id, ri.status, ri.request_line_id as "lineId", rl.request_id as "requestId"
       from request_item ri join request_line rl on rl.id = ri.request_line_id where ri.id = $1`,
    [itemId],
  );
  if (!item) throw new ApiError(404, 'Item not found.');
  if (item.status !== 'parked') throw new ApiError(400, 'Only a parked item can go back for new quotations.');
  await withTransaction(async (tx) => {
    await tx.query(`update request_item set status = 'awaiting_quotation', review_due_at = null, updated_at = now() where id = $1`, [
      itemId,
    ]);
    await tx.query(`delete from quote_choice where request_line_id = $1`, [item.lineId]);
  });
  await addRequestHistory({
    requestId: String(item.requestId),
    lineId: String(item.lineId),
    itemId,
    event: 'QuoteRecorded',
    byStaffId: user.id,
    note: 'Parked item sent back for new vendor quotations; the previous choice was cleared.',
  });
  return { ok: true };
}

export async function stockSummary() {
  const row = await one<Record<string, unknown>>(
    `select
       (select count(*) from asset where status = 'available')::int as "available",
       (select count(*) from request_item where status = 'requested')::int as "awaitingCheck",
       (select count(*) from request_item where status = 'awaiting_quotation')::int as "awaitingQuote",
       (select count(*) from request_item where status = 'approved')::int as "awaitingPurchase",
       (select count(*) from request_item where status = 'purchased')::int as "awaitingIssue",
       (select count(*) from asset_movement where status = 'pending')::int as "pendingMovements",
       (select count(*) from disposal where status = 'pending')::int as "pendingDisposals"`,
  );
  return row;
}
