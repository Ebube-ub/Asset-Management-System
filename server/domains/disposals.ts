import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError, parseBody } from '../lib/http.js';
import type { CurrentUser } from '../lib/auth.js';
import { addAssetHistory, iso, uid } from '../lib/repo.js';

export async function disposalList() {
  const rows = await query<Record<string, unknown>>(
    `select d.id, d.method, d.reason, d.status, d.proposed_at as "proposedAt", d.decided_at as "decidedAt",
            d.decision_note as "decisionNote", d.proceeds::float8 as proceeds, d.buyer,
            d.completed_at as "completedAt",
            a.id as "assetId", a.ref, a.serial_number as "serialNumber", a.status as "assetStatus",
            at.name as "assetTypeName", p.name as "proposedByName", dec.name as "decidedByName"
       from disposal d
       join asset a on a.id = d.asset_id
       join asset_type at on at.id = a.asset_type_id
       left join staff p on p.id = d.proposed_by
       left join staff dec on dec.id = d.decided_by
      order by (d.status = 'pending') desc, d.proposed_at desc`,
  );
  const totals = await one<Record<string, unknown>>(
    `select
       (select count(*) from disposal where status = 'pending')::int as "pending",
       (select count(*) from disposal where status = 'approved')::int as "approved",
       (select count(*) from disposal where status = 'completed')::int as "completed",
       (select coalesce(sum(proceeds),0)::float8 from disposal where status = 'completed') as "proceeds"`,
  );
  return {
    rows: rows.map((r) => ({
      ...r,
      proposedAt: iso(r.proposedAt),
      decidedAt: iso(r.decidedAt),
      completedAt: iso(r.completedAt),
    })),
    totals,
  };
}

export const proposeSchema = z.object({
  assetId: z.string().uuid(),
  method: z.enum(['sale', 'auction', 'scrap', 'donation', 'recycling']),
  reason: z.string().trim().min(5, 'Give a reason for the disposal.'),
});

export async function proposeDisposal(user: CurrentUser, body: unknown) {
  const input = parseBody(proposeSchema, body);
  const asset = await one<Record<string, unknown>>(
    `select a.id, a.ref, a.status, at.name as "assetTypeName" from asset a join asset_type at on at.id = a.asset_type_id where a.id = $1`,
    [input.assetId],
  );
  if (!asset) throw new ApiError(404, 'Asset not found.');
  if (asset.status === 'assigned') {
    throw new ApiError(400, 'This asset is assigned. It must be returned to stock before it can be proposed for disposal.');
  }
  if (asset.status === 'disposed') throw new ApiError(400, 'This asset has already been disposed of.');
  if (asset.status === 'awaiting_disposal') throw new ApiError(400, 'This asset already has a disposal awaiting approval.');

  const id = uid();
  await withTransaction(async (tx) => {
    await tx.query(
      `insert into disposal (id, asset_id, method, reason, proposed_by, status) values ($1,$2,$3,$4,$5,'pending')`,
      [id, input.assetId, input.method, input.reason, user.id],
    );
    await tx.query(`update asset set status = 'awaiting_disposal' where id = $1`, [input.assetId]);
    await tx.query(
      `insert into asset_history (id, asset_id, event, by_staff_id, note)
       values ($1,$2,'DisposalProposed',$3,$4)`,
      [uid(), input.assetId, user.id, `Proposed for ${input.method}. ${input.reason}`],
    );
  });
  return { id };
}

const decideSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function decideDisposal(user: CurrentUser, disposalId: string, body: unknown) {
  const input = parseBody(decideSchema, body);
  const disposal = await one<Record<string, unknown>>(
    `select d.id, d.status, d.asset_id as "assetId", d.method, d.proposed_by as "proposedBy", a.ref
       from disposal d join asset a on a.id = d.asset_id where d.id = $1`,
    [disposalId],
  );
  if (!disposal) throw new ApiError(404, 'Disposal not found.');
  if (disposal.status !== 'pending') throw new ApiError(400, 'This disposal has already been decided.');

  await withTransaction(async (tx) => {
    await tx.query(
      `update disposal set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1`,
      [disposalId, input.action === 'approve' ? 'approved' : 'rejected', user.id, input.note ?? null],
    );
    if (input.action === 'reject') {
      await tx.query(`update asset set status = 'available' where id = $1`, [disposal.assetId]);
    }
    await tx.query(
      `insert into asset_history (id, asset_id, event, by_staff_id, note)
       values ($1,$2,$3,$4,$5)`,
      [
        uid(),
        disposal.assetId,
        input.action === 'approve' ? 'DisposalApproved' : 'DisposalRejected',
        user.id,
        input.action === 'approve'
          ? `Disposal approved by the stock manager (${disposal.method}).`
          : `Disposal rejected — the asset returns to available.${input.note ? ` ${input.note}` : ''}`,
      ],
    );
  });
  return { ok: true };
}

const completeSchema = z.object({
  buyer: z.string().trim().max(200).optional().nullable(),
  proceeds: z.coerce.number().nonnegative().optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function completeDisposal(user: CurrentUser, disposalId: string, body: unknown) {
  const input = parseBody(completeSchema, body ?? {});
  const disposal = await one<Record<string, unknown>>(
    `select d.id, d.status, d.method, d.asset_id as "assetId", a.ref from disposal d
       join asset a on a.id = d.asset_id where d.id = $1`,
    [disposalId],
  );
  if (!disposal) throw new ApiError(404, 'Disposal not found.');
  if (disposal.status !== 'approved') {
    throw new ApiError(400, 'Only an approved disposal can be completed.');
  }
  const needsMoney = disposal.method === 'sale' || disposal.method === 'auction';
  if (needsMoney && (!input.buyer || input.proceeds === undefined)) {
    throw new ApiError(400, 'Record the buyer and the amount received for a sale or auction.');
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `update disposal set status = 'completed', completed_at = now(), buyer = $2, proceeds = $3 where id = $1`,
      [disposalId, input.buyer ?? null, needsMoney ? input.proceeds : null],
    );
    await tx.query(`update asset set status = 'disposed', holder_staff_id = null, room_id = null where id = $1`, [
      disposal.assetId,
    ]);
    await tx.query(
      `insert into asset_history (id, asset_id, event, by_staff_id, note)
       values ($1,$2,'AssetDisposed',$3,$4)`,
      [
        uid(),
        disposal.assetId,
        user.id,
        `Disposed by ${disposal.method}.` +
          (needsMoney ? ` Buyer: ${input.buyer}; received ₦${Number(input.proceeds).toLocaleString()}.` : '') +
          (input.note ? ` ${input.note}` : ''),
      ],
    );
  });
  return { ok: true };
}
