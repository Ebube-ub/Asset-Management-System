import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError, parseBody } from '../lib/http.js';
import type { CurrentUser } from '../lib/auth.js';
import { addRequestHistory, iso, nextAssetRef, recomputeRequestStatus, uid } from '../lib/repo.js';
import { saveAttributeValues } from './assetconfig.js';
import { appUrl, emailsForRoles, emailsForStaff, mailBody, sendMail } from '../lib/mailer.js';

export async function purchaseList() {
  const rows = await query<Record<string, unknown>>(
    `select p.id, p.vendor_name as "vendorName", p.cost::float8 as cost, p.receipt_url as "receiptUrl",
            p.receipt_name as "receiptName", p.photo_url as "photoUrl", p.recorded_at as "recordedAt",
            s.name as "recordedByName",
            r.ref, r.id as "requestId", rl.id as "lineId", at.name as "assetTypeName",
            fd.approved_amount::float8 as "approvedAmount", q.vendor_name as "quoteVendor",
            (select count(*) from asset a where a.purchase_id = p.id)::int as "assetCount",
            (select count(*) from asset a where a.purchase_id = p.id and a.photo_url is null)::int as "withoutPhoto"
       from purchase p
       join request_line rl on rl.id = p.request_line_id
       join request r on r.id = rl.request_id
       join asset_type at on at.id = rl.asset_type_id
       join staff s on s.id = p.recorded_by
       left join quote q on q.id = p.quote_id
       left join lateral (
         select approved_amount from financial_decision f
          where f.request_line_id = p.request_line_id order by f.decided_at desc limit 1
       ) fd on true
      order by p.recorded_at desc`,
  );
  return {
    rows: rows.map((r) => ({
      ...r,
      recordedAt: iso(r.recordedAt),
      overBudget: r.approvedAmount !== null && Number(r.cost) > Number(r.approvedAmount),
      difference:
        r.approvedAmount !== null ? Number(r.cost) - Number(r.approvedAmount) : null,
    })),
  };
}

/** Lines that are approved and still waiting for the manual purchase to be recorded. */
export async function awaitingPurchase() {
  const rows = await query<Record<string, unknown>>(
    `select rl.id as "lineId", r.id as "requestId", r.ref, r.priority,
            rf.name as "raisedForName", at.name as "assetTypeName", at.id as "assetTypeId",
            fd.approved_amount::float8 as "approvedAmount", fd.decided_at as "decidedAt",
            q.vendor_name as "vendorName", q.id as "quoteId",
            (select count(*) from request_item ri where ri.request_line_id = rl.id and ri.status = 'approved')::int as "approvedCount"
       from request_line rl
       join request r on r.id = rl.request_id
       join asset_type at on at.id = rl.asset_type_id
       join staff rf on rf.id = r.raised_for
       left join quote_choice qc on qc.request_line_id = rl.id
       left join quote q on q.id = qc.chosen_quote_id
       left join lateral (
         select approved_amount, decided_at, decision from financial_decision f
          where f.request_line_id = rl.id order by f.decided_at desc limit 1
       ) fd on true
      where exists (select 1 from request_item ri where ri.request_line_id = rl.id and ri.status = 'approved')
      order by case r.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
               r.raised_at asc`,
  );
  return { rows: rows.map((r) => ({ ...r, decidedAt: iso(r.decidedAt) })) };
}

/** One row per purchased item, so serial numbers and photos can be completed. */
const unitSchema = z.object({
  serialNumber: z.string().trim().max(100).optional().nullable(),
  condition: z.enum(['new', 'good', 'fair', 'poor']).optional(),
  photoUrl: z.string().max(500).optional().nullable(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const purchaseSchema = z.object({
  lineId: z.string().uuid(),
  vendorName: z.string().trim().min(1, 'Enter the vendor name.'),
  cost: z.coerce.number().positive('The cost must be greater than zero.'),
  receiptUrl: z.string().max(500).optional().nullable(),
  receiptName: z.string().max(200).optional().nullable(),
  photoUrl: z.string().max(500).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  /** Optional per-unit details, in the same order as the approved items. */
  units: z.array(unitSchema).max(50).optional(),
});

export async function recordPurchase(user: CurrentUser, body: unknown) {
  const input = parseBody(purchaseSchema, body);
  const line = await one<Record<string, unknown>>(
    `select rl.id, rl.request_id as "requestId", rl.asset_type_id as "assetTypeId",
            rl.recipient_room_id as "roomId", r.ref, at.name as "assetTypeName",
            at.custody_kind as "custodyKind", r.raised_for as "raisedFor",
            (select count(*) from request_item ri where ri.request_line_id = rl.id and ri.status = 'approved')::int as "approvedCount"
       from request_line rl
       join request r on r.id = rl.request_id
       join asset_type at on at.id = rl.asset_type_id
      where rl.id = $1`,
    [input.lineId],
  );
  if (!line) throw new ApiError(404, 'Request line not found.');
  if (Number(line.approvedCount) === 0) {
    throw new ApiError(400, 'There is nothing approved on this line waiting for a purchase.');
  }
  const decision = await one<{ approved_amount: string | null; decision: string }>(
    `select approved_amount, decision from financial_decision where request_line_id = $1 order by decided_at desc limit 1`,
    [input.lineId],
  );
  if (!decision || decision.decision !== 'approve') {
    throw new ApiError(400, 'This line has not been approved for purchase yet.');
  }
  if (input.units && input.units.length > Number(line.approvedCount)) {
    throw new ApiError(400, 'More item details were supplied than there are approved items.');
  }
  const choice = await one<{ chosen_quote_id: string }>(
    `select chosen_quote_id from quote_choice where request_line_id = $1`,
    [input.lineId],
  );

  const purchaseId = uid();
  const createdAssets: string[] = [];

  await withTransaction(async (tx) => {
    await tx.query(
      `insert into purchase (id, request_line_id, quote_id, vendor_name, cost, receipt_url, receipt_name, photo_url, recorded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        purchaseId,
        input.lineId,
        choice?.chosen_quote_id ?? null,
        input.vendorName,
        input.cost,
        input.receiptUrl ?? null,
        input.receiptName ?? null,
        input.photoUrl ?? null,
        user.id,
      ],
    );
    const items = await tx.query<{ id: string }>(
      `update request_item set status = 'purchased', updated_at = now()
        where request_line_id = $1 and status = 'approved' returning id`,
      [input.lineId],
    );
    let index = 0;
    for (const item of items) {
      const unit = input.units?.[index];
      const assetId = uid();
      const ref = await nextAssetRef();
      await tx.query(
        `insert into asset (id, ref, asset_type_id, serial_number, condition, status, purchase_id,
                            request_item_id, registered_by, notes, photo_url)
         values ($1,$2,$3,$4,$5,'available',$6,$7,$8,$9,$10)`,
        [
          assetId,
          ref,
          line.assetTypeId,
          unit?.serialNumber ?? null,
          unit?.condition ?? 'new',
          purchaseId,
          item.id,
          user.id,
          `Purchased from ${input.vendorName}.`,
          unit?.photoUrl ?? input.photoUrl ?? null,
        ],
      );
      await saveAttributeValues(tx, assetId, String(line.assetTypeId), unit?.attributes);
      await tx.query(
        `insert into asset_history (id, asset_id, event, by_staff_id, note)
         values ($1,$2,'AssetRegistered',$3,$4)`,
        [uid(), assetId, user.id, `Purchased from ${input.vendorName} on ${line.ref}; entered the register.`],
      );
      createdAssets.push(assetId);
      index += 1;
    }
  });

  await addRequestHistory({
    requestId: String(line.requestId),
    lineId: input.lineId,
    event: 'PurchaseRecorded',
    byStaffId: user.id,
    note:
      `Purchase recorded — ${input.vendorName}, ₦${input.cost.toLocaleString()}. ` +
      `${createdAssets.length} item(s) registered and ready to issue.` +
      (input.note ? ` ${input.note}` : ''),
  });
  await recomputeRequestStatus(String(line.requestId), user.id);

  // The stock manager and the requester both need to know stock has changed.
  const holders = await query<{ id: string }>(
    `select distinct coalesce(ri.recipient_staff_id, r.raised_for) as id
       from request_item ri join request_line rl on rl.id = ri.request_line_id
       join request r on r.id = rl.request_id
      where rl.id = $1`,
    [input.lineId],
  );
  const mailTo = new Set([...(await emailsForStaff(holders.map((h) => h.id))), ...(await emailsForRoles(['stock_manager']))]);
  for (const to of mailTo) {
    void sendMail({
      to,
      subject: `${line.ref} — purchased assets received and registered`,
      body: mailBody([
        `${createdAssets.length} item(s) purchased from ${input.vendorName} were registered into stock on ${line.ref}.`,
        'Serial numbers, photos and type-specific details can be completed in the asset register.',
        appUrl('/assets'),
      ]),
      dedupeKey: `purchase:${purchaseId}:received`,
    });
  }

  const approvedAmount = decision.approved_amount ? Number(decision.approved_amount) : null;
  return {
    purchaseId,
    assetIds: createdAssets,
    overBudget: approvedAmount !== null && input.cost > approvedAmount,
    approvedAmount,
    cost: input.cost,
  };
}
