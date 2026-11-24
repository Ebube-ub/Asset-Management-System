import { z } from 'zod';
import { one, query, withTransaction } from '../db/index.js';
import { ApiError } from '../lib/http.js';
import type { CurrentUser } from '../lib/auth.js';
import {
  addRequestHistory,
  directManager,
  hasRoleId,
  isAboveManager,
  managerChain,
  nextRequestRef,
  recomputeRequestStatus,
  requestAccess,
  teamMemberIds,
  uid,
} from '../lib/repo.js';
import { isAdmin } from '../lib/auth.js';
import type { Priority } from '../../shared/domain.js';

const optionalText = z.string().trim().max(2000).optional().nullable();

export const createRequestSchema = z
  .object({
    raisedForId: z.string().uuid().optional(),
    justification: z.string().trim().min(10, 'Give a justification of at least 10 characters.'),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    priorityJustification: optionalText,
    businessImpact: optionalText,
    lines: z
      .array(
        z.object({
          assetTypeId: z.string().uuid(),
          quantity: z.number().int().min(1).max(50),
          recipientRoomId: z.string().uuid().optional().nullable(),
          note: optionalText,
        }),
      )
      .min(1, 'Add at least one asset type.'),
  })
  .superRefine((value, ctx) => {
    if ((value.priority === 'high' || value.priority === 'critical') && !value.priorityJustification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priorityJustification'],
        message: 'A priority justification is required for High and Critical requests.',
      });
    }
    if ((value.priority === 'high' || value.priority === 'critical') && !value.businessImpact) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessImpact'],
        message: 'The business impact is required for High and Critical requests.',
      });
    }
  });

export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export async function createRequest(user: CurrentUser, input: CreateRequestInput) {
  const raisedForId = input.raisedForId ?? user.id;

  if (raisedForId !== user.id && !isAdmin(user)) {
    throw new ApiError(403, 'You can only raise a request for yourself.');
  }
  const recipient = await one<{ id: string; first_signed_in_at: string | null; left_at: string | null; name: string }>(
    `select id, first_signed_in_at, left_at, name from staff where id = $1`,
    [raisedForId],
  );
  if (!recipient) throw new ApiError(404, 'Staff member not found.');
  if (recipient.left_at) throw new ApiError(400, 'This staff member has left the organisation.');
  if (raisedForId !== user.id) {
    if (recipient.first_signed_in_at) {
      throw new ApiError(
        400,
        'The administrator can only raise requests for new hires who have never signed in. This staff member raises their own requests.',
      );
    }
  }

  const typeRows = await query<{ id: string; name: string; custody_kind: string }>(
    `select id, name, custody_kind from asset_type where id = any($1::uuid[])`,
    [input.lines.map((l) => l.assetTypeId)],
  );
  const types = new Map(typeRows.map((t) => [t.id, t]));
  if (types.size !== new Set(input.lines.map((l) => l.assetTypeId)).size) {
    throw new ApiError(400, 'One or more asset types are invalid.');
  }
  for (const line of input.lines) {
    const type = types.get(line.assetTypeId)!;
    if (type.custody_kind === 'location' && !line.recipientRoomId) {
      throw new ApiError(400, `Choose a room for ${type.name}: this asset type is held by location.`);
    }
    if (type.custody_kind === 'person' && line.recipientRoomId) {
      throw new ApiError(400, `${type.name} is assigned to a person, so it cannot be tied to a room.`);
    }
    if (type.custody_kind === 'location') {
      const room = await one(`select 1 from room where id = $1 and active = true`, [line.recipientRoomId]);
      if (!room) throw new ApiError(400, 'The selected room is not available.');
    }
  }

  const reviewer = await directManager(raisedForId);
  const ref = await nextRequestRef();
  const requestId = uid();
  const status = reviewer ? 'under_review' : 'in_progress';

  await withTransaction(async (tx) => {
    await tx.query(
      `insert into request (id, ref, raised_by, raised_for, justification, priority, priority_justification,
                            business_impact, status, current_reviewer_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        requestId,
        ref,
        user.id,
        raisedForId,
        input.justification,
        input.priority,
        input.priorityJustification ?? null,
        input.businessImpact ?? null,
        status,
        reviewer,
      ],
    );
    for (const line of input.lines) {
      const lineId = uid();
      await tx.query(
        `insert into request_line (id, request_id, asset_type_id, quantity, recipient_room_id, note)
         values ($1,$2,$3,$4,$5,$6)`,
        [lineId, requestId, line.assetTypeId, line.quantity, line.recipientRoomId ?? null, line.note ?? null],
      );
      for (let i = 0; i < line.quantity; i++) {
        await tx.query(
          `insert into request_item (id, request_line_id, seq, status) values ($1,$2,$3,'requested')`,
          [uid(), lineId, i + 1],
        );
      }
    }
  });

  await addRequestHistory({
    requestId,
    event: 'RequestRaised',
    byStaffId: user.id,
    note:
      `Priority ${input.priority}.` +
      (reviewer ? '' : ' No manager above the recipient, so line-manager review is skipped.'),
  });

  return getRequest(user, requestId);
}

export type RequestListFilters = {
  q?: string;
  status?: string;
  priority?: string;
  scope?: 'mine' | 'all' | 'team';
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
};

export async function listRequests(user: CurrentUser, filters: RequestListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, filters.pageSize ?? 10));
  const where: string[] = [];
  const params: unknown[] = [];

  const roleScope = filters.scope ?? 'all';
  if (roleScope === 'mine') {
    params.push(user.id);
    where.push(`(r.raised_by = $${params.length} or r.raised_for = $${params.length})`);
  } else if (roleScope === 'team') {
    params.push(user.id);
    where.push(`r.raised_for in (
      with recursive reports as (
        select s.id from staff s where s.manager_id = $${params.length}
        union all
        select s.id from staff s join reports rp on s.manager_id = rp.id
      ) select id from reports)`);
  } else {
    // Role-based visibility: staff see their own, managers their chain, others see all.
    const privileged = user.roles.some((r) =>
      ['administrator', 'stock_manager', 'financial_executive'].includes(r),
    );
    if (!privileged) {
      params.push(user.id);
      where.push(`(r.raised_by = $${params.length} or r.raised_for = $${params.length}
        or r.id in (select request_id from request_history where by_staff_id = $${params.length}))`);
    }
  }

  if (filters.status) {
    params.push(filters.status);
    where.push(`r.status = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    where.push(`r.priority = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(r.ref ilike $${params.length} or r.justification ilike $${params.length}
      or exists (select 1 from staff s where s.id = r.raised_for and s.name ilike $${params.length}))`);
  }

  const sortable: Record<string, string> = {
    ref: 'r.ref',
    raisedAt: 'r.raised_at',
    priority: `case r.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
    status: 'r.status',
  };
  const sort = sortable[filters.sort ?? 'raisedAt'] ?? 'r.raised_at';
  const dir = filters.dir === 'asc' ? 'asc' : 'desc';
  const whereSql = where.length ? `where ${where.join(' and ')}` : '';

  const totalRow = await one<{ total: string }>(`select count(*)::text as total from request r ${whereSql}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await query<Record<string, unknown>>(
    `select r.id, r.ref, r.priority, r.status, r.raised_at as "raisedAt", r.justification,
            rb.name as "raisedByName", rf.name as "raisedForName",
            cr.name as "currentReviewerName",
            (select count(*) from request_line rl where rl.request_id = r.id)::int as "lineCount",
            (select coalesce(sum(rl.quantity),0) from request_line rl where rl.request_id = r.id)::int as "itemCount",
            (select count(*) from request_item ri join request_line rl on rl.id = ri.request_line_id
              where rl.request_id = r.id and ri.status = 'issued')::int as "issuedCount",
            (select string_agg(distinct at.name, ', ') from request_line rl
              join asset_type at on at.id = rl.asset_type_id where rl.request_id = r.id) as items
       from request r
       join staff rb on rb.id = r.raised_by
       join staff rf on rf.id = r.raised_for
       left join staff cr on cr.id = r.current_reviewer_id
       ${whereSql}
      order by ${sort} ${dir}
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  return {
    rows: rows.map((r) => ({
      ...r,
      raisedAt: r.raisedAt instanceof Date ? r.raisedAt.toISOString() : r.raisedAt,
    })),
    total: Number(totalRow?.total ?? 0),
    page,
    pageSize,
  };
}

export async function getRequest(user: CurrentUser, requestId: string) {
  const access = await requestAccess(user, requestId);
  if (!access) throw new ApiError(404, 'Request not found.');
  if (!access.canView) throw new ApiError(403, 'You do not have permission to view this request.');

  const request = await one<Record<string, unknown>>(
    `select r.id, r.ref, r.raised_by as "raisedById", r.raised_for as "raisedForId", r.raised_at as "raisedAt",
            r.justification, r.priority, r.priority_justification as "priorityJustification",
            r.business_impact as "businessImpact", r.status, r.current_reviewer_id as "currentReviewerId",
            r.review_restarts as "reviewRestarts",
            rb.name as "raisedByName", rb.email as "raisedByEmail", rf.name as "raisedForName",
            rf.email as "raisedForEmail", rf.first_signed_in_at as "raisedForFirstSignedIn",
            cr.name as "currentReviewerName"
       from request r
       join staff rb on rb.id = r.raised_by
       join staff rf on rf.id = r.raised_for
       left join staff cr on cr.id = r.current_reviewer_id
      where r.id = $1`,
    [requestId],
  );
  if (!request) throw new ApiError(404, 'Request not found.');

  const lines = await query<Record<string, unknown>>(
    `select rl.id, rl.quantity, rl.asset_type_id as "assetTypeId", rl.recipient_room_id as "recipientRoomId",
            rl.note, at.name as "assetTypeName", at.custody_kind as "custodyKind",
            rm.name as "roomName",
            (select count(*) from asset a where a.asset_type_id = rl.asset_type_id and a.status = 'available')::int as "availableCount",
            fd.decision as "decision", fd.approved_amount as "approvedAmount",
            fd.decided_at as "decidedAt", fds.name as "decidedByName",
            (select qc.id from quote_choice qc where qc.request_line_id = rl.id) as "choiceId",
            (select q.amount from quote_choice qc join quote q on q.id = qc.chosen_quote_id
              where qc.request_line_id = rl.id) as "chosenAmount",
            (select p.cost from purchase p where p.request_line_id = rl.id order by p.recorded_at desc limit 1) as "cost",
            (select p.id from purchase p where p.request_line_id = rl.id order by p.recorded_at desc limit 1) as "purchaseId",
            (select count(*) from quote q where q.request_line_id = rl.id)::int as "quoteCount"
       from request_line rl
       join asset_type at on at.id = rl.asset_type_id
       left join room rm on rm.id = rl.recipient_room_id
       left join lateral (
         select * from financial_decision f where f.request_line_id = rl.id order by f.decided_at desc limit 1
       ) fd on true
       left join staff fds on fds.id = fd.decided_by
      where rl.request_id = $1
      order by at.name`,
    [requestId],
  );

  const items = await query<Record<string, unknown>>(
    `select ri.id, ri.status, ri.closed_reason as "closedReason", ri.review_due_at as "reviewDueAt",
            ri.request_line_id as "lineId", ri.seq, ri.issued_asset_id as "issuedAssetId",
            a.ref as "assetRef", a.serial_number as "serialNumber"
       from request_item ri
       join request_line rl on rl.id = ri.request_line_id
       left join asset a on a.id = ri.issued_asset_id
      where rl.request_id = $1
      order by rl.asset_type_id, ri.seq`,
    [requestId],
  );

  const history = await query<Record<string, unknown>>(
    `select h.id, h.event, h.at, h.note, s.name as "byName", h.request_item_id as "itemId"
       from request_history h left join staff s on s.id = h.by_staff_id
      where h.request_id = $1 order by h.at desc, h.id`,
    [requestId],
  );

  const quotes = await query<Record<string, unknown>>(
    `select q.id, q.request_line_id as "lineId", q.vendor_name as "vendorName", q.amount,
            q.delivery_days as "deliveryDays", q.warranty_months as "warrantyMonths",
            q.quality_rating as "qualityRating", q.document_url as "documentUrl",
            q.document_name as "documentName", q.recorded_at as "recordedAt", s.name as "recordedByName"
       from quote q join staff s on s.id = q.recorded_by
       join request_line rl on rl.id = q.request_line_id
      where rl.request_id = $1 order by q.recorded_at`,
    [requestId],
  );

  const choice = await one<Record<string, unknown>>(
    `select qc.chosen_quote_id as "chosenQuoteId", qc.recommended_quote_id as "recommendedQuoteId",
            qc.weights_used as "weightsUsed", qc.reason, qc.chosen_at as "chosenAt", s.name as "chosenByName"
       from quote_choice qc join staff s on s.id = qc.chosen_by
       join request_line rl on rl.id = qc.request_line_id
      where rl.request_id = $1 limit 1`,
    [requestId],
  );

  const purchased = await query<Record<string, unknown>>(
    `select p.id, p.request_line_id as "lineId", p.vendor_name as "vendorName", p.cost,
            p.receipt_url as "receiptUrl", p.receipt_name as "receiptName",
            p.recorded_at as "recordedAt", s.name as "recordedByName"
       from purchase p join staff s on s.id = p.recorded_by
       join request_line rl on rl.id = p.request_line_id
      where rl.request_id = $1 order by p.recorded_at`,
    [requestId],
  );

  let chain: { id: string; name: string }[] = [];
  const raisedForId = String(request.raisedForId);
  const reviewers = await managerChain(raisedForId);
  if (reviewers.length) {
    const staffRows = await query<{ id: string; name: string }>(
      `select id, name from staff where id = any($1::uuid[])`,
      [reviewers],
    );
    chain = reviewers
      .map((id) => staffRows.find((s) => s.id === id))
      .filter((s): s is { id: string; name: string } => !!s);
  }

  const toIso = <T extends Record<string, unknown>>(rows: T[], keys: string[]) =>
    rows.map((r) => {
      const copy: Record<string, unknown> = { ...r };
      for (const k of keys) if (copy[k]) copy[k] = copy[k] instanceof Date ? (copy[k] as Date).toISOString() : copy[k];
      return copy;
    });

  return {
    request: toIso([request], ['raisedAt', 'raisedForFirstSignedIn'])[0],
    lines: lines.map((l) => ({
      ...l,
      approvedAmount: l.approvedAmount !== null ? Number(l.approvedAmount) : null,
      chosenAmount: l.chosenAmount !== null ? Number(l.chosenAmount) : null,
      cost: l.cost !== null ? Number(l.cost) : null,
      overBudget:
        l.cost !== null && l.approvedAmount !== null ? Number(l.cost) > Number(l.approvedAmount) : false,
      decidedAt: l.decidedAt instanceof Date ? (l.decidedAt as Date).toISOString() : l.decidedAt,
    })),
    items: toIso(items, ['reviewDueAt']),
    history: toIso(history, ['at']),
    quotes: quotes.map((q) => ({ ...q, amount: Number(q.amount), recordedAt: isoDate(q.recordedAt) })),
    choice: choice
      ? { ...choice, weightsUsed: choice.weightsUsed, chosenAt: isoDate(choice.chosenAt) }
      : null,
    purchases: purchased.map((p) => ({ ...p, cost: Number(p.cost), recordedAt: isoDate(p.recordedAt) })),
    reviewChain: chain,
    access,
  };
}

function isoDate(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export const reviewSchema = z.object({
  action: z.enum(['pass', 'reject']),
  note: z.string().trim().max(1000).optional().nullable(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  priorityJustification: optionalText,
  businessImpact: optionalText,
});

export async function reviewRequest(user: CurrentUser, requestId: string, input: z.infer<typeof reviewSchema>) {
  const access = await requestAccess(user, requestId);
  if (!access) throw new ApiError(404, 'Request not found.');
  if (!access.canReview) {
    throw new ApiError(403, 'You are not the current reviewer for this request.');
  }
  const request = await one<Record<string, unknown>>(
    `select id, ref, raised_for as "raisedFor", status, priority, priority_justification as "priorityJustification",
            business_impact as "businessImpact"
       from request where id = $1`,
    [requestId],
  );
  if (!request) throw new ApiError(404, 'Request not found.');
  if (request.status !== 'under_review') throw new ApiError(400, 'This request is not awaiting review.');

  // Reporting-line changes restart the review with the recipient's new manager.
  const stillAbove = await isAboveManager(user.id, String(request.raisedFor));
  if (!stillAbove) {
    const newManager = await directManager(String(request.raisedFor));
    await query(
      `update request set current_reviewer_id = $2, review_restarts = review_restarts + 1 where id = $1`,
      [requestId, newManager],
    );
    await addRequestHistory({
      requestId,
      event: 'ReviewRestarted',
      byStaffId: user.id,
      note: newManager
        ? `Reporting lines changed: review restarted with ${await staffName(newManager)}.`
        : 'Reporting lines changed: the recipient now has no manager, so review moved to the stock check.',
    });
    if (!newManager) {
      await query(`update request set status = 'in_progress' where id = $1`, [requestId]);
    }
    throw new ApiError(
      409,
      newManager
        ? `The reporting line changed. The review has restarted with ${await staffName(newManager)}.`
        : 'The reporting line changed. The request has moved to the stock check.',
    );
  }

  let priority = String(request.priority) as Priority;
  let priorityJustification = request.priorityJustification as string | null;
  let businessImpact = request.businessImpact as string | null;

  if (input.priority && input.priority !== priority) {
    priority = input.priority;
    if (input.priority === 'high' || input.priority === 'critical') {
      priorityJustification = input.priorityJustification ?? null;
      businessImpact = input.businessImpact ?? null;
      if (!priorityJustification || !businessImpact) {
        throw new ApiError(
          400,
          'Raising the priority to High or Critical needs a priority justification and the business impact.',
        );
      }
    }
  }

  if (input.action === 'reject') {
    await withTransaction(async (tx) => {
      await tx.query(
        `update request set status = 'rejected', current_reviewer_id = null, priority = $2,
                priority_justification = $3, business_impact = $4
          where id = $1`,
        [requestId, priority, priorityJustification, businessImpact],
      );
      await tx.query(
        `update request_item set status = 'closed', closed_reason = 'declined', updated_at = now()
          where request_line_id in (select id from request_line where request_id = $1)
            and status not in ('issued','closed')`,
        [requestId],
      );
    });
    await addRequestHistory({
      requestId,
      event: 'RequestRejected',
      byStaffId: user.id,
      note: input.note || 'Rejected by reviewer. The request is closed.',
    });
    return getRequest(user, requestId);
  }

  const next = await directManager(user.id);
  const isLineManager = await hasRoleId(user.id, 'line_manager');
  const goesToStock = isLineManager || !next;

  await query(
    `update request set current_reviewer_id = $2, status = $3, priority = $4,
            priority_justification = $5, business_impact = $6
      where id = $1`,
    [
      requestId,
      goesToStock ? null : next,
      goesToStock ? 'in_progress' : 'under_review',
      priority,
      priorityJustification,
      businessImpact,
    ],
  );

  await addRequestHistory({
    requestId,
    event: 'RequestPassedReview',
    byStaffId: user.id,
    note:
      (input.note ? input.note + ' ' : '') +
      (goesToStock
        ? `Passed to the stock check${isLineManager ? ' by the line manager' : ' (top of the reporting chain)'}.`
        : `Passed to ${await staffName(next!)} for the next review.`),
  });

  return getRequest(user, requestId);
}

export async function staffName(id: string): Promise<string> {
  const row = await one<{ name: string }>(`select name from staff where id = $1`, [id]);
  return row?.name ?? 'Unknown';
}

export async function approvalsQueue(user: CurrentUser) {
  const rows = await query<Record<string, unknown>>(
    `select r.id, r.ref, r.priority, r.raised_at as "raisedAt", r.justification,
            rb.name as "raisedByName", rf.name as "raisedForName",
            (select coalesce(sum(rl.quantity),0) from request_line rl where rl.request_id = r.id)::int as "itemCount",
            (select string_agg(at.name, ', ') from request_line rl join asset_type at on at.id = rl.asset_type_id
              where rl.request_id = r.id) as items,
            (select count(*) from request_history h where h.request_id = r.id and h.event = 'RequestPassedReview')::int as "alreadyPassed"
       from request r
       join staff rb on rb.id = r.raised_by
       join staff rf on rf.id = r.raised_for
      where r.status = 'under_review' and r.current_reviewer_id = $1
      order by case r.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
               r.raised_at asc`,
    [user.id],
  );
  const team = await teamMemberIds(user.id);
  return {
    rows: rows.map((r) => ({
      ...r,
      raisedAt: isoDate(r.raisedAt),
    })),
    teamSize: team.length,
  };
}
