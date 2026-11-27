import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError, parseBody } from '../lib/http.js';
import type { CurrentUser } from '../lib/auth.js';
import { addAssetHistory, addRequestHistory, iso, recomputeRequestStatus, uid } from '../lib/repo.js';
import { emailsForRoles, emailsForStaff, mailBody, sendMail, appUrl } from '../lib/mailer.js';
import { resolveReleaseAuthorization } from './assets.js';

const priorityOrder = `case r.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

export async function stockQueue() {
  const rows = await query<Record<string, unknown>>(
    `select rl.id as "lineId", r.id as "requestId", r.ref, r.priority, r.raised_at as "raisedAt", r.is_group as "isGroup",
            r.justification, rf.name as "raisedForName", rf.id as "raisedForId",
            at.id as "assetTypeId", at.name as "assetTypeName", at.custody_kind as "custodyKind", at.category,
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
        `select ri.id, ri.request_line_id as "lineId", ri.seq, ri.status, ri.recipient_staff_id as "recipientId",
                rec.name as "recipientName",
                (select count(*) from request_item x where x.request_line_id = ri.request_line_id and x.seq <= ri.seq)::int as "position"
           from request_item ri
           left join staff rec on rec.id = ri.recipient_staff_id
          where ri.request_line_id = any($1::uuid[]) and ri.status in ('requested','purchased')
          order by ri.request_line_id, ri.seq`,
        [lineIds],
      )
    : [];

  const available = rows.length
    ? await query<Record<string, unknown>>(
        `select a.id, a.ref, a.serial_number as "serialNumber", a.asset_type_id as "assetTypeId",
                a.condition, a.status, a.photo_url as "photoUrl"
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
  authorizedById: z.string().uuid({ message: 'Name the person who authorised this release.' }),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function issueItems(user: CurrentUser, lineId: string, body: unknown) {
  const input = parseBody(issueSchema, body);
  const line = await one<Record<string, unknown>>(
    `select rl.id, rl.asset_type_id as "assetTypeId", rl.recipient_room_id as "roomId",
            r.id as "requestId", r.ref, r.raised_for as "raisedFor", r.priority, at.custody_kind as "custodyKind",
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
  const requestStatus = await one<{ status: string }>(`select status from request where id = $1`, [line.requestId]);
  if (!requestStatus || requestStatus.status !== 'in_progress') {
    throw new ApiError(400, 'Only a request that has cleared its approvals can be issued from stock.');
  }

  // Only a stock manager or administrator reaches this endpoint, and a second
  // authorised person must approve the release itself.
  const authorization = await resolveReleaseAuthorization(user, input.authorizedById);
  // Resolved before the transaction opens: a nested query on the single PGlite
  // connection would wait on the transaction that is holding it.
  const authorizerName = await staffLabel(authorization.authorizedBy);

  const issued: { assetId: string; ref: string; recipientName: string }[] = [];
  await withTransaction(async (tx) => {
    for (const assignment of input.assignments) {
      const item = await tx.one<{
        id: string;
        status: string;
        lineId: string;
        requestId: string;
        recipientId: string | null;
      }>(
        `select ri.id, ri.status, ri.request_line_id as "lineId", rl.request_id as "requestId",
                ri.recipient_staff_id as "recipientId"
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

      // A group request issues each unit to the person it was allocated to.
      const holderId =
        line.custodyKind === 'person' ? (item.recipientId ?? String(line.raisedFor)) : null;
      const roomId = line.custodyKind === 'location' ? String(line.roomId) : null;
      if (line.custodyKind === 'location' && !roomId) {
        throw new ApiError(400, 'This request line needs a room before it can be issued.');
      }
      const holderName =
        holderId === null
          ? String(line.roomName)
          : ((await tx.one<{ name: string }>(`select name from staff where id = $1`, [holderId]))?.name ?? 'the holder');

      await tx.query(
        `update asset set status = 'assigned', holder_staff_id = $2, room_id = $3, request_item_id = $4,
                handover_status = 'awaiting_handover'
          where id = $1`,
        [assignment.assetId, holderId, roomId, item.id],
      );
      await tx.query(
        `insert into asset_release (id, asset_id, request_item_id, recipient_staff_id, room_id,
                                    authorized_by, issued_by, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          uid(),
          assignment.assetId,
          item.id,
          holderId,
          roomId,
          authorization.authorizedBy,
          user.id,
          input.note ?? null,
        ],
      );
      await tx.query(
        `update request_item set status = 'issued', issued_asset_id = $2, updated_at = now() where id = $1`,
        [item.id, assignment.assetId],
      );
      await tx.query(
        `insert into asset_history (id, asset_id, event, from_holder, to_holder, by_staff_id, note)
         values ($1,$2,'AssetIssued','Stock',$3,$4,$5)`,
        [
          uid(),
          assignment.assetId,
          holderName,
          user.id,
          `Issued on ${line.ref}. Release authorised by ${authorizerName}. Awaiting handover.`,
        ],
      );
      await tx.query(
        `insert into request_history (id, request_id, request_line_id, request_item_id, event, by_staff_id, note)
         values ($1,$2,$3,$4,'ItemIssued',$5,$6)`,
        [
          uid(),
          item.requestId,
          lineId,
          item.id,
          user.id,
          `Issued ${asset.ref} (${line.assetTypeName}) to ${holderName}.`,
        ],
      );
      issued.push({ assetId: assignment.assetId, ref: String(asset.ref), recipientName: holderName });
    }
  });

  await recomputeRequestStatus(String(line.requestId), user.id);

  // Everyone affected hears about the release; the stock manager sees the
  // movement in their feed automatically because it is on the asset history.
  const holderIds = await query<{ id: string }>(
    `select distinct holder_staff_id as id from asset where id = any($1::uuid[]) and holder_staff_id is not null`,
    [issued.map((i) => i.assetId)],
  );
  for (const to of await emailsForStaff([...holderIds.map((h) => h.id), String(line.raisedFor)])) {
    void sendMail({
      to,
      subject: `${line.ref} — asset issued, awaiting handover`,
      body: mailBody([
        `${issued.length} item(s) were issued on ${line.ref}.`,
        'The stock manager still has to record the handover or collection.',
        appUrl(`/requests/${line.requestId}`),
      ]),
      dedupeKey: `request:${line.requestId}:issued:${issued.map((i) => i.assetId).join('-')}`,
    });
  }
  for (const to of await emailsForRoles(['stock_manager'])) {
    void sendMail({
      to,
      subject: `${line.ref} — stock released`,
      body: mailBody([
        `${issued.length} item(s) left stock on ${line.ref}. Stock availability has been updated.`,
        appUrl('/stock'),
      ]),
      dedupeKey: `stock:${line.requestId}:released:${issued.map((i) => i.assetId).join('-')}`,
    });
  }

  return { issued: issued.length, requestId: line.requestId };
}

async function staffLabel(id: string): Promise<string> {
  const row = await one<{ name: string }>(`select name from staff where id = $1`, [id]);
  return row?.name ?? 'the authorised approver';
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
    note: `${rows.length} item(s) were not available in stock — sent for vendor quotations.`,
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
    await tx.query(
      `update request_item set status = 'awaiting_quotation', review_due_at = null, updated_at = now() where id = $1`,
      [itemId],
    );
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
       (select count(*) from asset where status = 'assigned' and handover_status = 'awaiting_handover')::int as "awaitingHandover",
       (select count(*) from request_item where status = 'requested')::int as "awaitingCheck",
       (select count(*) from request_item where status = 'awaiting_quotation')::int as "awaitingQuote",
       (select count(*) from request_item where status = 'approved')::int as "awaitingPurchase",
       (select count(*) from request_item where status = 'purchased')::int as "awaitingIssue",
       (select count(*) from asset_movement where status = 'pending')::int as "pendingMovements",
       (select count(*) from disposal where status = 'pending')::int as "pendingDisposals"`,
  );
  return row;
}

/** Stock levels low enough for the stock manager to act on. */
export async function stockLevels() {
  const rows = await query<Record<string, unknown>>(
    `select t.id, t.name as "assetTypeName", t.category,
            c.name as "categoryName", cl.name as "assetClassName",
            count(a.id) filter (where a.status = 'available')::int as "available",
            count(a.id) filter (where a.status = 'assigned')::int as "assigned",
            count(a.id)::int as "total",
            (select count(*) from request_item ri join request_line rl on rl.id = ri.request_line_id
              where rl.asset_type_id = t.id and ri.status in ('requested','purchased'))::int as "demand"
       from asset_type t
       join asset_category c on c.id = t.category_id
       join asset_class cl on cl.id = c.class_id
       left join asset a on a.asset_type_id = t.id
      where t.active = true
      group by t.id, t.name, t.category, c.name, cl.name
      order by "available" asc, t.name`,
  );
  return {
    rows: rows.map((r) => ({ ...r, low: Number(r.available) === 0 && Number(r.demand) > 0 })),
  };
}
