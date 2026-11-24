import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError, parseBody } from '../lib/http.js';
import type { CurrentUser } from '../lib/auth.js';
import { addRequestHistory, getSettings, iso, recomputeRequestStatus, uid } from '../lib/repo.js';

const priorityOrder = `case r.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

export async function financePending(user: CurrentUser) {
  const settings = await getSettings();
  const rows = await query<Record<string, unknown>>(
    `select rl.id as "lineId", r.id as "requestId", r.ref, r.priority, r.raised_at as "raisedAt",
            r.justification, r.raised_by as "raisedById", r.raised_for as "raisedForId",
            rf.name as "raisedForName", rb.name as "raisedByName",
            at.name as "assetTypeName", rm.name as "roomName",
            (select count(*) from request_item ri where ri.request_line_id = rl.id and ri.status = 'awaiting_decision')::int as "awaitingCount",
            (select count(*) from request_item ri where ri.request_line_id = rl.id and ri.status = 'parked')::int as "parkedCount",
            (select min(ri.review_due_at) from request_item ri where ri.request_line_id = rl.id and ri.status = 'parked') as "reviewDueAt",
            (select min(ri.review_due_at) from request_item ri where ri.request_line_id = rl.id and ri.status = 'parked') < now() as "dueForReview",
            qc.chosen_quote_id as "chosenQuoteId",
            q.vendor_name as "vendorName", q.amount as "chosenAmount",
            (select count(*) from quote qq where qq.request_line_id = rl.id)::int as "quoteCount"
       from request_line rl
       join request r on r.id = rl.request_id
       join asset_type at on at.id = rl.asset_type_id
       join staff rf on rf.id = r.raised_for
       join staff rb on rb.id = r.raised_by
       left join room rm on rm.id = rl.recipient_room_id
       left join quote_choice qc on qc.request_line_id = rl.id
       left join quote q on q.id = qc.chosen_quote_id
      where exists (
        select 1 from request_item ri
         where ri.request_line_id = rl.id and ri.status in ('awaiting_decision','parked')
      )
      order by coalesce((select min(ri.review_due_at) from request_item ri
                          where ri.request_line_id = rl.id and ri.status = 'parked') < now(), false) desc,
               ${priorityOrder}, r.raised_at asc`,
  );

  const myself = rows.filter((r) => r.raisedById === user.id || r.raisedForId === user.id);
  const isSecond = settings.secondApproverId === user.id;
  const pending = rows
    .filter((r) => (r.raisedById === user.id || r.raisedForId === user.id ? isSecond : true))
    .map((r) => ({
      ...r,
      raisedAt: iso(r.raisedAt),
      reviewDueAt: iso(r.reviewDueAt),
      chosenAmount: r.chosenAmount !== null ? Number(r.chosenAmount) : null,
      canDecide: !(r.raisedById === user.id || r.raisedForId === user.id) || isSecond,
    }));

  const history = await query<Record<string, unknown>>(
    `select fd.id, fd.decision, fd.approved_amount as "approvedAmount", fd.decided_at as "decidedAt",
            fd.note, s.name as "decidedByName", r.ref, r.id as "requestId", rl.id as "lineId",
            at.name as "assetTypeName"
       from financial_decision fd
       join request_line rl on rl.id = fd.request_line_id
       join request r on r.id = rl.request_id
       join asset_type at on at.id = rl.asset_type_id
       join staff s on s.id = fd.decided_by
      order by fd.decided_at desc limit 100`,
  );

  const totals = await one<Record<string, unknown>>(
    `select
       (select coalesce(sum(approved_amount),0)::float8 from financial_decision where decision = 'approve') as "approvedSpend",
       (select count(*) from request_item where status = 'parked' and review_due_at < now())::int as "dueForReview",
       (select count(*) from request_item where status = 'awaiting_decision')::int as "awaitingDecision",
       (select count(*) from request_item where status = 'parked')::int as "parked"`,
  );

  return {
    rows: pending,
    ownRequests: myself.length,
    settings: {
      parkedReviewDays: settings.parkedReviewDays,
      secondApproverId: settings.secondApproverId,
      secondApproverName: settings.secondApproverName,
    },
    history: history.map((h) => ({
      ...h,
      approvedAmount: h.approvedAmount !== null ? Number(h.approvedAmount) : null,
      decidedAt: iso(h.decidedAt),
    })),
    totals,
  };
}

const decisionSchema = z.object({
  decision: z.enum(['approve', 'decline', 'defer']),
  approvedAmount: z.coerce.number().nonnegative().optional(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export async function decide(user: CurrentUser, lineId: string, body: unknown) {
  const input = parseBody(decisionSchema, body);
  const settings = await getSettings();
  const line = await one<Record<string, unknown>>(
    `select rl.id, rl.request_id as "requestId", rl.quantity, r.ref,
            r.raised_by as "raisedById", r.raised_for as "raisedForId", r.priority
       from request_line rl join request r on r.id = rl.request_id where rl.id = $1`,
    [lineId],
  );
  if (!line) throw new ApiError(404, 'Request line not found.');

  const isOwnRequest = line.raisedById === user.id || line.raisedForId === user.id;
  const isSecond = settings.secondApproverId === user.id;
  if (isOwnRequest && !isSecond) {
    throw new ApiError(
      403,
      settings.secondApproverId
        ? `You cannot approve your own request. ${settings.secondApproverName} is the configured second approver.`
        : 'You cannot approve your own request and no second approver is configured. Ask the administrator to set one.',
    );
  }
  if (!user.roles.includes('financial_executive') && !isSecond) {
    throw new ApiError(403, 'Only the financial executive can record a financial decision.');
  }

  const items = await query<{ id: string; status: string; review_due_at: string | null }>(
    `select id, status, review_due_at from request_item where request_line_id = $1 and status in ('awaiting_decision','parked')`,
    [lineId],
  );
  if (!items.length) throw new ApiError(400, 'There is nothing on this line awaiting a financial decision.');

  const choice = await one<{ chosen_quote_id: string; amount: string }>(
    `select qc.chosen_quote_id, q.amount from quote_choice qc join quote q on q.id = qc.chosen_quote_id
      where qc.request_line_id = $1`,
    [lineId],
  );

  if (input.decision === 'approve') {
    if (!choice) throw new ApiError(400, 'Choose a quotation before approving. A request cannot go to finance without one.');
  }

  const amount =
    input.decision === 'approve'
      ? input.approvedAmount ?? Number(choice!.amount)
      : null;
  if (input.decision === 'approve' && (!amount || amount <= 0)) {
    throw new ApiError(400, 'Record the approved amount.');
  }

  const reviewDue = new Date(Date.now() + settings.parkedReviewDays * 24 * 60 * 60 * 1000);

  await withTransaction(async (tx) => {
    await tx.query(
      `insert into financial_decision (id, request_line_id, decision, approved_amount, decided_by, note)
       values ($1,$2,$3,$4,$5,$6)`,
      [uid(), lineId, input.decision, amount, user.id, input.note ?? null],
    );
    if (input.decision === 'approve') {
      await tx.query(
        `update request_item set status = 'approved', review_due_at = null, updated_at = now()
          where request_line_id = $1 and status in ('awaiting_decision','parked')`,
        [lineId],
      );
    } else if (input.decision === 'decline') {
      await tx.query(
        `update request_item set status = 'closed', closed_reason = 'declined', review_due_at = null, updated_at = now()
          where request_line_id = $1 and status in ('awaiting_decision','parked')`,
        [lineId],
      );
    } else {
      await tx.query(
        `update request_item set status = 'parked', review_due_at = $2, updated_at = now()
          where request_line_id = $1 and status in ('awaiting_decision','parked')`,
        [lineId, reviewDue],
      );
    }
  });

  const decisionWord = input.decision === 'approve' ? 'Approved' : input.decision === 'decline' ? 'Declined' : 'Deferred';
  await addRequestHistory({
    requestId: String(line.requestId),
    lineId,
    event: 'FinancialDecisionRecorded',
    byStaffId: user.id,
    note:
      `${decisionWord} by the financial executive` +
      (amount ? ` — ₦${Number(amount).toLocaleString()}` : '') +
      (input.decision === 'defer' ? ` — parked, due for review ${reviewDue.toDateString()}.` : '.') +
      (input.note ? ` ${input.note}` : ''),
  });
  await recomputeRequestStatus(String(line.requestId), user.id);
  return { ok: true };
}
