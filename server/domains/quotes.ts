import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError, parseBody } from '../lib/http.js';
import type { CurrentUser } from '../lib/auth.js';
import { activeWeights, addRequestHistory, iso, recomputeRequestStatus, uid } from '../lib/repo.js';
import { scoreQuotes, type ScoredQuote } from '../../shared/domain.js';

const priorityOrder = `case r.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

export async function quotationQueue() {
  const rows = await query<any>(
    `select rl.id as "lineId", r.id as "requestId", r.ref, r.priority, r.raised_at as "raisedAt",
            r.justification, rf.name as "raisedForName",
            at.name as "assetTypeName", at.custody_kind as "custodyKind",
            rl.quantity,
            (select count(*) from request_item ri where ri.request_line_id = rl.id and ri.status = 'awaiting_quotation')::int as "awaitingCount",
            (select count(*) from quote q where q.request_line_id = rl.id)::int as "quoteCount",
            (select count(*) from quote_choice qc where qc.request_line_id = rl.id)::int as "hasChoice",
            rm.name as "roomName"
       from request_line rl
       join request r on r.id = rl.request_id
       join asset_type at on at.id = rl.asset_type_id
       join staff rf on rf.id = r.raised_for
       left join room rm on rm.id = rl.recipient_room_id
      where exists (
        select 1 from request_item ri
         where ri.request_line_id = rl.id and ri.status in ('awaiting_quotation','parked')
      )
      order by ${priorityOrder}, r.raised_at asc`,
  );
  const weights = await activeWeights();
  return { rows: rows.map((r) => ({ ...r, raisedAt: iso(r.raisedAt) })), weights };
}

export async function quotationDetail(lineId: string) {
  const line = await one<any>(
    `select rl.id as "lineId", rl.quantity, rl.recipient_room_id as "recipientRoomId",
            r.id as "requestId", r.ref, r.priority, r.status as "requestStatus", r.raised_at as "raisedAt",
            r.justification, r.raised_for as "raisedForId",
            rf.name as "raisedForName", at.name as "assetTypeName", at.id as "assetTypeId",
            at.custody_kind as "custodyKind", rm.name as "roomName",
            (select count(*) from request_item ri where ri.request_line_id = rl.id and ri.status = 'awaiting_quotation')::int as "awaitingCount",
            (select count(*) from request_item ri where ri.request_line_id = rl.id and ri.status = 'parked')::int as "parkedCount",
            (select count(*) from request_item ri where ri.request_line_id = rl.id and ri.status = 'awaiting_decision')::int as "awaitingDecisionCount"
       from request_line rl
       join request r on r.id = rl.request_id
       join asset_type at on at.id = rl.asset_type_id
       join staff rf on rf.id = r.raised_for
       left join room rm on rm.id = rl.recipient_room_id
      where rl.id = $1`,
    [lineId],
  );
  if (!line) throw new ApiError(404, 'Quotation set not found.');

  const weights = await activeWeights();
  const quotes = await query<any>(
    `select q.id, q.vendor_name as "vendorName", q.amount, q.delivery_days as "deliveryDays",
            q.warranty_months as "warrantyMonths", q.quality_rating as "qualityRating",
            q.document_url as "documentUrl", q.document_name as "documentName",
            q.recorded_at as "recordedAt", s.name as "recordedByName"
       from quote q join staff s on s.id = q.recorded_by
      where q.request_line_id = $1 order by q.recorded_at`,
    [lineId],
  );

  const scored = scoreQuotes(
    quotes.map((q) => ({
      id: String(q.id),
      amount: Number(q.amount),
      qualityRating: Number(q.qualityRating),
      deliveryDays: Number(q.deliveryDays),
      warrantyMonths: Number(q.warrantyMonths),
      recordedAt: String(iso(q.recordedAt)),
    })),
    weights,
  );
  const recommendedId = scored.find((q) => q.recommended)?.id ?? null;

  const choice = await one<any>(
    `select qc.id, qc.chosen_quote_id as "chosenQuoteId", qc.recommended_quote_id as "recommendedQuoteId",
            qc.weights_used as "weightsUsed", qc.reason, qc.chosen_at as "chosenAt", s.name as "chosenByName"
       from quote_choice qc join staff s on s.id = qc.chosen_by
      where qc.request_line_id = $1`,
    [lineId],
  );

  const decision = await one<any>(
    `select fd.decision, fd.approved_amount as "approvedAmount", fd.decided_at as "decidedAt", s.name as "decidedByName"
       from financial_decision fd join staff s on s.id = fd.decided_by
      where fd.request_line_id = $1 order by fd.decided_at desc limit 1`,
    [lineId],
  );

  const items = await query<any>(
    `select id, status, review_due_at as "reviewDueAt" from request_item where request_line_id = $1 order by seq`,
    [lineId],
  );

  return {
    line: { ...line, raisedAt: iso(line.raisedAt) },
    quotes: quotes.map((q) => ({ ...q, amount: Number(q.amount), recordedAt: iso(q.recordedAt) })),
    scored: scored as ScoredQuote[],
    recommendedId,
    weights,
    choice: choice
      ? { ...choice, chosenAt: iso(choice.chosenAt) }
      : null,
    decision: decision
      ? { ...decision, approvedAmount: decision.approvedAmount !== null ? Number(decision.approvedAmount) : null, decidedAt: iso(decision.decidedAt) }
      : null,
    items: items.map((i) => ({ ...i, reviewDueAt: iso(i.reviewDueAt) })),
  };
}

export const quoteSchema = z.object({
  vendorName: z.string().trim().min(1, 'Vendor name is required.'),
  amount: z.coerce.number().positive('Amount must be greater than zero.'),
  deliveryDays: z.coerce.number().int().min(0, 'Delivery days cannot be negative.'),
  warrantyMonths: z.coerce.number().int().min(0, 'Warranty cannot be negative.'),
  qualityRating: z.coerce.number().int().min(1).max(5),
  documentUrl: z.string().max(500).optional().nullable(),
  documentName: z.string().max(200).optional().nullable(),
});

export async function addQuote(user: CurrentUser, lineId: string, body: unknown) {
  const input = parseBody(quoteSchema, body);
  const line = await one<{ id: string; requestId: string; ref: string }>(
    `select rl.id, rl.request_id as "requestId", r.ref from request_line rl join request r on r.id = rl.request_id where rl.id = $1`,
    [lineId],
  );
  if (!line) throw new ApiError(404, 'Request line not found.');
  const pending = await one<{ count: string }>(
    `select count(*)::text as count from request_item where request_line_id = $1 and status in ('awaiting_quotation','parked','awaiting_decision')`,
    [lineId],
  );
  if (!pending || Number(pending.count) === 0) {
    throw new ApiError(400, 'This line is not in the quotation stage.');
  }
  const id = uid();
  await query(
    `insert into quote (id, request_line_id, vendor_name, amount, delivery_days, warranty_months,
                        quality_rating, document_url, document_name, recorded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      lineId,
      input.vendorName,
      input.amount,
      input.deliveryDays,
      input.warrantyMonths,
      input.qualityRating,
      input.documentUrl ?? null,
      input.documentName ?? null,
      user.id,
    ],
  );
  await addRequestHistory({
    requestId: line.requestId,
    lineId,
    event: 'QuoteRecorded',
    byStaffId: user.id,
    note: `${input.vendorName} — ₦${input.amount.toLocaleString()} · quality ${input.qualityRating}/5 · ${input.deliveryDays} days · ${input.warrantyMonths} months warranty.`,
  });
  return quotationDetail(lineId);
}

const chooseSchema = z.object({
  quoteId: z.string().uuid(),
  reason: z.string().trim().max(1000).optional().nullable(),
});

export async function chooseQuote(user: CurrentUser, lineId: string, body: unknown) {
  const input = parseBody(chooseSchema, body);
  const detail = await quotationDetail(lineId);
  const chosen = detail.quotes.find((q) => q.id === input.quoteId);
  if (!chosen) throw new ApiError(400, 'That quotation is not part of this set.');
  const recommended = detail.recommendedId;
  if (!recommended) throw new ApiError(400, 'Record at least one quotation before choosing.');
  if (input.quoteId !== recommended && !input.reason?.trim()) {
    throw new ApiError(400, 'Choosing a quotation other than the recommended one needs a reason.');
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `insert into quote_choice (id, request_line_id, recommended_quote_id, chosen_quote_id, weights_used, reason, chosen_by)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (request_line_id) do update
         set recommended_quote_id = excluded.recommended_quote_id,
             chosen_quote_id = excluded.chosen_quote_id,
             weights_used = excluded.weights_used,
             reason = excluded.reason,
             chosen_by = excluded.chosen_by,
             chosen_at = now()`,
      [
        uid(),
        lineId,
        recommended,
        input.quoteId,
        JSON.stringify(detail.weights),
        input.reason ?? null,
        user.id,
      ],
    );
    await tx.query(
      `update request_item set status = 'awaiting_decision', review_due_at = null, updated_at = now()
        where request_line_id = $1 and status in ('awaiting_quotation','parked')`,
      [lineId],
    );
  });

  await addRequestHistory({
    requestId: String(detail.line.requestId),
    lineId,
    event: 'QuoteChosen',
    byStaffId: user.id,
    note: `Chose ${chosen.vendorName} at ₦${chosen.amount.toLocaleString()}${
      input.quoteId === recommended ? ' (recommended)' : ` (not the recommendation — reason: ${input.reason})`
    }. Weights used: price ${detail.weights.price}%, quality ${detail.weights.quality}%, delivery ${detail.weights.delivery}%, warranty ${detail.weights.warranty}%.`,
  });
  await recomputeRequestStatus(String(detail.line.requestId), user.id);
  return quotationDetail(lineId);
}
