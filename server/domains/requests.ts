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
  requestAccess,
  teamMemberIds,
  uid,
} from '../lib/repo.js';
import { isAdmin } from '../lib/auth.js';
import { appUrl, emailsForRoles, emailsForStaff, mailBody, sendMail } from '../lib/mailer.js';
import type { Priority, Role } from '../../shared/domain.js';

const optionalText = z.string().trim().max(2000).optional().nullable();

/** How senior a role is, so "the Head of Department or above" is enforceable. */
const ROLE_RANK: Record<Role, number> = {
  team_lead: 1,
  line_manager: 2,
  stock_manager: 3,
  financial_executive: 3,
  administrator: 4,
};

function holdsLevel(roles: Role[], required: string): boolean {
  const need = ROLE_RANK[required as Role] ?? 99;
  return roles.some((r) => (ROLE_RANK[r] ?? 0) >= need);
}

const lineSchema = z.object({
  assetTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(50),
  recipientRoomId: z.string().uuid().optional().nullable(),
  note: optionalText,
  /** Group requests only: which team member receives each unit. */
  recipients: z
    .array(
      z.object({
        staffId: z.string().uuid(),
        quantity: z.number().int().min(1).max(50),
      }),
    )
    .optional()
    .nullable(),
});

export const createRequestSchema = z
  .object({
    raisedForId: z.string().uuid().optional(),
    justification: z.string().trim().min(10, 'Explain what you need and why (at least 10 characters).'),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    priorityJustification: optionalText,
    businessImpact: optionalText,
    lines: z.array(lineSchema).min(1, 'Add at least one asset.'),
  })
  .superRefine((value, ctx) => {
    if ((value.priority === 'high' || value.priority === 'critical') && !value.priorityJustification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priorityJustification'],
        message: 'Explain why this needs High or Critical priority.',
      });
    }
    if ((value.priority === 'high' || value.priority === 'critical') && !value.businessImpact) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessImpact'],
        message: 'Describe the business impact if this is delayed.',
      });
    }
  });

export type CreateRequestInput = z.infer<typeof createRequestSchema>;

async function loadTypeContext(typeIds: string[]) {
  const rows = await query<{
    id: string;
    name: string;
    custody_kind: string;
    category: string;
    min_request_role: string | null;
    active: boolean;
    category_id: string | null;
    category_active: boolean | null;
    class_active: boolean | null;
  }>(
    `select t.id, t.name, t.custody_kind, c.name as category,
            coalesce(t.min_request_role, c.min_request_role, cl.min_request_role) as min_request_role,
            t.active, t.category_id, c.active as category_active, cl.active as class_active
       from asset_type t
       left join asset_category c on c.id = t.category_id
       left join asset_class cl on cl.id = c.class_id
      where t.id = any($1::uuid[])`,
    [typeIds],
  );

  // An inactive class, category or type stays on historical records but cannot
  // be chosen for new work — even if the client bypasses the form entirely.
  for (const row of rows) {
    if (!row.category_id || row.category_active === null || row.class_active === null) {
      throw new ApiError(
        400,
        `${row.name} is not fully configured. Ask an administrator to place it in an asset category and asset class.`,
      );
    }
    if (!row.active || !row.category_active || !row.class_active) {
      throw new ApiError(
        400,
        `${row.name} is no longer available for new requests because it, its category or its class is inactive.`,
      );
    }
  }

  return new Map(rows.map((r) => [r.id, r]));
}

/** An asset category can be reserved for a minimum role level. Enforced here, not in the UI. */
async function assertMayRequest(types: Map<string, { name: string; min_request_role: string | null }>, requesterRoles: Role[]) {
  for (const type of types.values()) {
    if (type.min_request_role && !holdsLevel(requesterRoles, type.min_request_role)) {
      throw new ApiError(
        403,
        `${type.name} can only be requested by a ${type.min_request_role.replace('_', ' ')} or above. Ask your manager to raise it for you.`,
      );
    }
  }
}

export async function createRequest(user: CurrentUser, input: CreateRequestInput) {
  const raisedForId = input.raisedForId ?? user.id;

  if (raisedForId !== user.id && !isAdmin(user)) {
    throw new ApiError(403, 'You can only request assets for yourself.');
  }
  const recipient = await one<{ id: string; first_signed_in_at: string | null; left_at: string | null; name: string }>(
    `select id, first_signed_in_at, left_at, name from staff where id = $1`,
    [raisedForId],
  );
  if (!recipient) throw new ApiError(404, 'Staff member not found.');
  if (recipient.left_at) throw new ApiError(400, 'This staff member has left the organisation.');
  if (raisedForId !== user.id && recipient.first_signed_in_at) {
    throw new ApiError(
      400,
      'The administrator can only raise requests for a new hire who has never signed in. Everyone else requests their own equipment.',
    );
  }

  const types = await loadTypeContext(input.lines.map((l) => l.assetTypeId));
  if (types.size !== new Set(input.lines.map((l) => l.assetTypeId)).size) {
    throw new ApiError(400, 'One or more of the chosen assets are not available.');
  }

  // Group requests are a line manager's tool: one request, several people.
  const isGroup = input.lines.some((l) => (l.recipients?.length ?? 0) > 0);
  if (isGroup && !(user.roles.includes('line_manager') || isAdmin(user))) {
    throw new ApiError(403, 'Only a line manager can raise a group request.');
  }

  const requesterRoles = raisedForId === user.id ? user.roles : await rolesOf(raisedForId);
  await assertMayRequest(types, requesterRoles);

  const teamIds = isGroup && !isAdmin(user) ? new Set(await teamMemberIds(user.id)) : null;

  for (const line of input.lines) {
    const type = types.get(line.assetTypeId)!;
    if (type.custody_kind === 'location' && !line.recipientRoomId) {
      throw new ApiError(400, `Choose a room for ${type.name}: it is held by a location.`);
    }
    if (type.custody_kind === 'person' && line.recipientRoomId) {
      throw new ApiError(400, `${type.name} is assigned to a person, so it cannot be tied to a room.`);
    }
    if (type.custody_kind === 'location') {
      const room = await one(`select 1 from room where id = $1 and active = true`, [line.recipientRoomId]);
      if (!room) throw new ApiError(400, 'The selected room is not available.');
    }
    if (line.recipients?.length) {
      if (type.custody_kind === 'location') {
        throw new ApiError(400, `${type.name} is held by a location, so it cannot be allocated to individual people.`);
      }
      const total = line.recipients.reduce((sum, r) => sum + r.quantity, 0);
      if (total !== line.quantity) {
        throw new ApiError(
          400,
          `The people chosen for ${type.name} add up to ${total}, but the quantity is ${line.quantity}.`,
        );
      }
      const ids = [...new Set(line.recipients.map((r) => r.staffId))];
      const people = await query<{ id: string; name: string; left_at: string | null }>(
        `select id, name, left_at from staff where id = any($1::uuid[])`,
        [ids],
      );
      if (people.length !== ids.length) throw new ApiError(400, 'One of the chosen people could not be found.');
      for (const person of people) {
        if (person.left_at) throw new ApiError(400, `${person.name} has left the organisation.`);
        if (teamIds && !teamIds.has(person.id)) {
          throw new ApiError(403, `${person.name} is not in your team, so you cannot request assets for them.`);
        }
      }
    }
  }

  const reviewer = await directManager(raisedForId);
  const ref = await nextRequestRef();
  const requestId = uid();
  const status = reviewer ? 'under_review' : 'in_progress';

  await withTransaction(async (tx) => {
    await tx.query(
      `insert into request (id, ref, raised_by, raised_for, justification, priority, priority_justification,
                            business_impact, status, current_reviewer_id, is_group)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
        isGroup,
      ],
    );
    for (const line of input.lines) {
      const lineId = uid();
      await tx.query(
        `insert into request_line (id, request_id, asset_type_id, quantity, recipient_room_id, note)
         values ($1,$2,$3,$4,$5,$6)`,
        [lineId, requestId, line.assetTypeId, line.quantity, line.recipientRoomId ?? null, line.note ?? null],
      );
      if (line.recipients?.length) {
        for (const person of line.recipients) {
          await tx.query(
            `insert into request_line_recipient (id, request_line_id, staff_id, quantity) values ($1,$2,$3,$4)`,
            [uid(), lineId, person.staffId, person.quantity],
          );
        }
        // One tracked unit per person, in a stable order.
        let seq = 0;
        for (const person of line.recipients) {
          for (let i = 0; i < person.quantity; i++) {
            seq += 1;
            await tx.query(
              `insert into request_item (id, request_line_id, seq, status, recipient_staff_id)
               values ($1,$2,$3,'requested',$4)`,
              [uid(), lineId, seq, person.staffId],
            );
          }
        }
      } else {
        for (let i = 0; i < line.quantity; i++) {
          await tx.query(
            `insert into request_item (id, request_line_id, seq, status) values ($1,$2,$3,'requested')`,
            [uid(), lineId, i + 1],
          );
        }
      }
    }
  });

  await addRequestHistory({
    requestId,
    event: 'RequestRaised',
    byStaffId: user.id,
    note:
      `Priority ${input.priority}.` +
      (isGroup ? ' Group request raised by the line manager for several team members.' : '') +
      (reviewer ? '' : ' No manager above the requester, so line-manager review is skipped.'),
  });

  // Never let a mail problem roll back a submitted request.
  void notifyRequestSubmitted(requestId, ref, user, recipient.name, reviewer);
  return getRequest(user, requestId);
}

async function rolesOf(staffId: string): Promise<Role[]> {
  const rows = await query<{ role: Role }>(`select role from staff_role where staff_id = $1`, [staffId]);
  return rows.map((r) => r.role);
}

async function notifyRequestSubmitted(
  requestId: string,
  ref: string,
  user: CurrentUser,
  recipientName: string,
  reviewer: string | null,
) {
  const link = appUrl(`/requests/${requestId}`);
  const requesterEmails = await emailsForStaff([user.id]);
  for (const to of requesterEmails) {
    await sendMail({
      to,
      subject: `${ref} — request submitted`,
      body: mailBody([
        `Your request ${ref} has been submitted${recipientName !== user.name ? ` for ${recipientName}` : ''}.`,
        reviewer ? 'It is now with your reviewer.' : 'It has gone straight to the stock check.',
        link,
      ]),
      dedupeKey: `request:${requestId}:submitted:${user.id}`,
    });
  }
  if (reviewer) {
    for (const to of await emailsForStaff([reviewer])) {
      await sendMail({
        to,
        subject: `${ref} — request waiting for your review`,
        body: mailBody([
          `${user.name} submitted ${ref}${recipientName !== user.name ? ` for ${recipientName}` : ''}.`,
          'It is waiting for your decision: pass it on, return it for editing, or reject it.',
          link,
        ]),
        dedupeKey: `request:${requestId}:review:${reviewer}`,
      });
    }
  }
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
    where.push(
      `(r.raised_by = $${params.length} or r.raised_for = $${params.length}
        or exists (select 1 from request_item ri join request_line rl on rl.id = ri.request_line_id
                    where rl.request_id = r.id and ri.recipient_staff_id = $${params.length}))`,
    );
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
        or r.id in (select request_id from request_history where by_staff_id = $${params.length})
        or exists (select 1 from request_item ri join request_line rl on rl.id = ri.request_line_id
                    where rl.request_id = r.id and ri.recipient_staff_id = $${params.length}))`);
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
    `select r.id, r.ref, r.priority, r.status, r.raised_at as "raisedAt", r.justification, r.is_group as "isGroup",
            rb.name as "raisedByName", rf.name as "raisedForName",
            cr.name as "currentReviewerName", ret.name as "returnedByName",
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
       left join staff ret on ret.id = r.returned_by
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
            r.review_restarts as "reviewRestarts", r.is_group as "isGroup",
            r.returned_by as "returnedById", r.returned_at as "returnedAt", r.return_reason as "returnReason",
            r.resubmitted_at as "resubmittedAt",
            rb.name as "raisedByName", rb.email as "raisedByEmail", rf.name as "raisedForName",
            rf.email as "raisedForEmail", rf.first_signed_in_at as "raisedForFirstSignedIn",
            cr.name as "currentReviewerName", ret.name as "returnedByName"
       from request r
       join staff rb on rb.id = r.raised_by
       join staff rf on rf.id = r.raised_for
       left join staff cr on cr.id = r.current_reviewer_id
       left join staff ret on ret.id = r.returned_by
      where r.id = $1`,
    [requestId],
  );
  if (!request) throw new ApiError(404, 'Request not found.');

  const lines = await query<Record<string, unknown>>(
    `select rl.id, rl.quantity, rl.asset_type_id as "assetTypeId", rl.recipient_room_id as "recipientRoomId",
            rl.note, at.name as "assetTypeName", at.custody_kind as "custodyKind", at.category as "categoryName",
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

  const recipients = await query<Record<string, unknown>>(
    `select rlr.request_line_id as "lineId", rlr.staff_id as "staffId", rlr.quantity, s.name
       from request_line_recipient rlr
       join staff s on s.id = rlr.staff_id
       join request_line rl on rl.id = rlr.request_line_id
      where rl.request_id = $1
      order by s.name`,
    [requestId],
  );

  const items = await query<Record<string, unknown>>(
    `select ri.id, ri.status, ri.closed_reason as "closedReason", ri.review_due_at as "reviewDueAt",
            ri.request_line_id as "lineId", ri.seq, ri.issued_asset_id as "issuedAssetId",
            ri.recipient_staff_id as "recipientStaffId", rs.name as "recipientName",
            a.ref as "assetRef", a.serial_number as "serialNumber", a.handover_status as "handoverStatus"
       from request_item ri
       join request_line rl on rl.id = ri.request_line_id
       left join asset a on a.id = ri.issued_asset_id
       left join staff rs on rs.id = ri.recipient_staff_id
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

  const approvals = await query<Record<string, unknown>>(
    `select ra.id, ra.stage, ra.required_role as "requiredRole", ra.label, ra.status,
            ra.decided_at as "decidedAt", ra.note, s.name as "decidedByName"
       from request_approval ra left join staff s on s.id = ra.decided_by
      where ra.request_id = $1 order by ra.stage`,
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
            p.receipt_url as "receiptUrl", p.receipt_name as "receiptName", p.photo_url as "photoUrl",
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

  const sitsWithMe = approvals.find(
    (a) => a.status === 'pending' && user.roles.includes(a.requiredRole as Role),
  );

  return {
    request: toIso([request], ['raisedAt', 'raisedForFirstSignedIn', 'returnedAt', 'resubmittedAt'])[0],
    lines: lines.map((l) => ({
      ...l,
      approvedAmount: l.approvedAmount !== null ? Number(l.approvedAmount) : null,
      chosenAmount: l.chosenAmount !== null ? Number(l.chosenAmount) : null,
      cost: l.cost !== null ? Number(l.cost) : null,
      overBudget:
        l.cost !== null && l.approvedAmount !== null ? Number(l.cost) > Number(l.approvedAmount) : false,
      recipients: recipients.filter((r) => r.lineId === l.id),
      decidedAt: l.decidedAt instanceof Date ? (l.decidedAt as Date).toISOString() : l.decidedAt,
    })),
    items: toIso(items, ['reviewDueAt']),
    history: toIso(history, ['at']),
    approvals: toIso(approvals, ['decidedAt']),
    quotes: quotes.map((q) => ({ ...q, amount: Number(q.amount), recordedAt: isoDate(q.recordedAt) })),
    choice: choice ? { ...choice, weightsUsed: choice.weightsUsed, chosenAt: isoDate(choice.chosenAt) } : null,
    purchases: purchased.map((p) => ({ ...p, cost: Number(p.cost), recordedAt: isoDate(p.recordedAt) })),
    reviewChain: chain,
    access: {
      ...access,
      canEdit: access.isRequester && request.status === 'returned',
      canResubmit: access.isRequester && request.status === 'returned',
      canDecideApproval: request.status === 'awaiting_approval' && !!sitsWithMe,
    },
  };
}

function isoDate(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function toIso<T extends Record<string, unknown>>(rows: T[], keys: string[]) {
  return rows.map((r) => {
    const copy: Record<string, unknown> = { ...r };
    for (const k of keys) if (copy[k]) copy[k] = copy[k] instanceof Date ? (copy[k] as Date).toISOString() : copy[k];
    return copy;
  });
}

export const reviewSchema = z.object({
  // `pass` covers both a reporting-line review and a category approval stage.
  action: z.enum(['pass', 'reject', 'return']),
  note: z.string().trim().max(1000).optional().nullable(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  priorityJustification: optionalText,
  businessImpact: optionalText,
});

/**
 * The approval levels a request must clear, derived from its asset types.
 * A rule set on the type wins over the category, which wins over the class, so
 * different classes can carry genuinely different approval requirements.
 * Roles already exercised during the reporting-line review are skipped so the
 * same manager is never asked twice.
 */
export async function approvalStagesFor(requestId: string): Promise<{ role: Role; stage: number; label: string }[]> {
  const rows = await query<{ required_role: string; stage: number; source: string }>(
    `select distinct
            coalesce(t.approval_role, c.approval_role, cl.approval_role) as required_role,
            coalesce(t.approval_stage, c.approval_stage, cl.approval_stage, 1) as stage,
            case when t.approval_role is not null then t.name
                 when c.approval_role is not null then c.name
                 else cl.name end as source
       from request_line rl
       join asset_type t on t.id = rl.asset_type_id
       join asset_category c on c.id = t.category_id
       join asset_class cl on cl.id = c.class_id
      where rl.request_id = $1
        and coalesce(t.approval_role, c.approval_role, cl.approval_role) is not null
      order by stage, source`,
    [requestId],
  );
  if (!rows.length) return [];

  const exercised = await query<{ role: string }>(
    `select distinct sr.role
       from request_history h join staff_role sr on sr.staff_id = h.by_staff_id
      where h.request_id = $1 and h.event = 'RequestPassedReview'`,
    [requestId],
  );
  const already = new Set(exercised.map((e) => e.role));

  const out: { role: Role; stage: number; label: string }[] = [];
  const seenRoles = new Set<string>();
  const seenStages = new Set<number>();
  for (const row of rows) {
    if (already.has(row.required_role) || seenRoles.has(row.required_role)) continue;
    // request_approval allows one stage per number; the first source wins.
    if (seenStages.has(Number(row.stage))) continue;
    seenRoles.add(row.required_role);
    seenStages.add(Number(row.stage));
    out.push({
      role: row.required_role as Role,
      stage: out.length + 1,
      label: `${row.source} requires ${row.required_role.replace('_', ' ')} approval`,
    });
  }
  return out;
}

async function createApprovalStages(requestId: string, stages: { role: Role; stage: number; label: string }[]) {
  for (const stage of stages) {
    await query(
      `insert into request_approval (id, request_id, stage, required_role, label)
       values ($1,$2,$3,$4,$5) on conflict (request_id, stage) do nothing`,
      [uid(), requestId, stage.stage, stage.role, stage.label],
    );
  }
}

async function pendingApproval(requestId: string) {
  return one<{ id: string; required_role: string; stage: number; label: string | null }>(
    `select id, required_role, stage, label from request_approval
      where request_id = $1 and status = 'pending' order by stage limit 1`,
    [requestId],
  );
}

export async function reviewRequest(user: CurrentUser, requestId: string, input: z.infer<typeof reviewSchema>) {
  const request = await one<Record<string, unknown>>(
    `select id, ref, raised_by as "raisedBy", raised_for as "raisedFor", status, priority,
            priority_justification as "priorityJustification", business_impact as "businessImpact",
            current_reviewer_id as "currentReviewerId"
       from request where id = $1`,
    [requestId],
  );
  if (!request) throw new ApiError(404, 'Request not found.');

  const status = String(request.status);
  const isReviewStage = status === 'under_review' && request.currentReviewerId === user.id;
  let approval: Awaited<ReturnType<typeof pendingApproval>> = null;
  if (status === 'awaiting_approval') {
    approval = await pendingApproval(requestId);
    const allowed = approval && holdsLevel(user.roles, approval.required_role);
    if (!allowed) throw new ApiError(403, 'This approval stage belongs to a different role.');
  }
  if (!isReviewStage && !approval) {
    throw new ApiError(403, 'This request is not waiting for a decision from you.');
  }

  // A reporting-line change restarts the review rather than silently skipping it.
  if (isReviewStage) {
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
          : 'Reporting lines changed: the requester now has no manager, so review moved to the stock check.',
      });
      if (!newManager) await query(`update request set status = 'in_progress' where id = $1`, [requestId]);
      throw new ApiError(
        409,
        newManager
          ? `The reporting line changed. The review has restarted with ${await staffName(newManager)}.`
          : 'The reporting line changed. The request has moved to the stock check.',
      );
    }
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

  const ref = String(request.ref);
  const raisedById = String(request.raisedBy);
  const stageNote = approval ? ` (${approval.label ?? `${approval.required_role} approval`})` : '';

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
      await tx.query(
        `update request_approval set status = 'rejected', decided_by = $2, decided_at = now(), note = $3
          where request_id = $1 and status = 'pending'`,
        [requestId, user.id, input.note ?? null],
      );
    });
    await addRequestHistory({
      requestId,
      event: 'RequestRejected',
      byStaffId: user.id,
      note: (input.note ? `${input.note} ` : '') + `Rejected${stageNote}. The request is closed.`,
    });
    void notifyDecision(requestId, ref, raisedById, 'rejected', user.name, input.note ?? null);
    return getRequest(user, requestId);
  }

  if (input.action === 'return') {
    if (!input.note) {
      throw new ApiError(400, 'Explain what needs to change before returning the request.');
    }
    await withTransaction(async (tx) => {
      await tx.query(
        `update request set status = 'returned', returned_by = $2, returned_at = now(),
                return_reason = $3, priority = $4, priority_justification = $5, business_impact = $6
          where id = $1`,
        [requestId, user.id, input.note, priority, priorityJustification, businessImpact],
      );
      if (approval) {
        await tx.query(
          `update request_approval set status = 'returned', decided_by = $2, decided_at = now(), note = $3
            where id = $1`,
          [approval.id, user.id, input.note],
        );
      }
    });
    await addRequestHistory({
      requestId,
      event: 'RequestReturned',
      byStaffId: user.id,
      note: `Returned to the requester for editing${stageNote}: ${input.note}`,
    });
    void notifyDecision(requestId, ref, raisedById, 'returned', user.name, input.note);
    return getRequest(user, requestId);
  }

  // ---- pass / approve ----
  if (approval) {
    await query(
      `update request_approval set status = 'approved', decided_by = $2, decided_at = now(), note = $3 where id = $1`,
      [approval.id, user.id, input.note ?? null],
    );
    await query(
      `update request set priority = $2, priority_justification = $3, business_impact = $4 where id = $1`,
      [requestId, priority, priorityJustification, businessImpact],
    );
    await addRequestHistory({
      requestId,
      event: 'ApprovalPassed',
      byStaffId: user.id,
      note: (input.note ? `${input.note} ` : '') + `Approved${stageNote}.`,
    });

    const next = await pendingApproval(requestId);
    if (next) {
      void notifyApprover(requestId, ref, next.required_role);
      return getRequest(user, requestId);
    }
    await query(`update request set status = 'in_progress' where id = $1`, [requestId]);
    await addRequestHistory({
      requestId,
      event: 'RequestPassedReview',
      byStaffId: user.id,
      note: 'All required approvals are complete — the request has moved to the stock check.',
    });
    void notifyDecision(requestId, ref, raisedById, 'approved', user.name, input.note ?? null);
    return getRequest(user, requestId);
  }

  const nextManager = await directManager(user.id);
  const isLineManager = await hasRoleId(user.id, 'line_manager');
  const goesToStock = isLineManager || !nextManager;

  await query(
    `update request set current_reviewer_id = $2, status = $3, priority = $4,
            priority_justification = $5, business_impact = $6
      where id = $1`,
    [
      requestId,
      goesToStock ? null : nextManager,
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
        : `Passed to ${await staffName(nextManager!)} for the next review.`),
  });

  if (goesToStock) {
    // Category rules decide whether a further approval level is needed.
    const stages = await approvalStagesFor(requestId);
    if (stages.length) {
      await createApprovalStages(requestId, stages);
      await query(`update request set status = 'awaiting_approval' where id = $1`, [requestId]);
      await addRequestHistory({
        requestId,
        event: 'ApprovalRequested',
        byStaffId: user.id,
        note: `Sent for ${stages.map((s) => s.role.replace('_', ' ')).join(', then ')} approval before the stock check.`,
      });
      void notifyApprover(requestId, ref, stages[0].role);
    } else {
      void notifyDecision(requestId, ref, raisedById, 'approved', user.name, input.note ?? null);
    }
  } else {
    for (const to of await emailsForStaff([nextManager!])) {
      void sendMail({
        to,
        subject: `${ref} — request waiting for your review`,
        body: mailBody([`${ref} has been passed to you for review.`, appUrl(`/requests/${requestId}`)]),
        dedupeKey: `request:${requestId}:review:${nextManager}:${user.id}`,
      });
    }
  }

  return getRequest(user, requestId);
}

async function notifyDecision(
  requestId: string,
  ref: string,
  raisedById: string,
  outcome: 'approved' | 'rejected' | 'returned',
  actorName: string,
  note: string | null,
) {
  const link = appUrl(`/requests/${requestId}`);
  const subject =
    outcome === 'returned'
      ? `${ref} — returned for editing`
      : outcome === 'rejected'
        ? `${ref} — rejected`
        : `${ref} — approved`;
  const line =
    outcome === 'returned'
      ? `${actorName} returned ${ref} for editing. Open it, make the changes and resubmit.`
      : outcome === 'rejected'
        ? `${actorName} rejected ${ref}. It is now closed.`
        : `${actorName} approved the next stage of ${ref}.`;
  for (const to of await emailsForStaff([raisedById])) {
    await sendMail({
      to,
      subject,
      body: mailBody([line, note ? `Comment: ${note}` : '', link]),
      dedupeKey: `request:${requestId}:${outcome}:${Date.now()}`,
    });
  }
}

async function notifyApprover(requestId: string, ref: string, role: string) {
  for (const to of await emailsForRoles([role])) {
    await sendMail({
      to,
      subject: `${ref} — approval needed (${role.replace('_', ' ')})`,
      body: mailBody([
        `${ref} needs ${role.replace('_', ' ')} approval before stock can be checked.`,
        appUrl(`/requests/${requestId}`),
      ]),
      dedupeKey: `request:${requestId}:approval:${role}`,
    });
  }
}

export async function staffName(id: string): Promise<string> {
  const row = await one<{ name: string }>(`select name from staff where id = $1`, [id]);
  return row?.name ?? 'Unknown';
}

// ------------------------------------------------------------------
// Editing and resubmitting a returned request
// ------------------------------------------------------------------
export const editRequestSchema = z
  .object({
    justification: z.string().trim().min(10, 'Explain what you need and why (at least 10 characters).').optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    priorityJustification: optionalText,
    businessImpact: optionalText,
    lines: z.array(lineSchema).min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const needsDetail = value.priority === 'high' || value.priority === 'critical';
    if (needsDetail && !value.priorityJustification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priorityJustification'],
        message: 'Explain why this needs High or Critical priority.',
      });
    }
    if (needsDetail && !value.businessImpact) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessImpact'],
        message: 'Describe the business impact if this is delayed.',
      });
    }
  });

export async function updateReturnedRequest(
  user: CurrentUser,
  requestId: string,
  input: z.infer<typeof editRequestSchema>,
) {
  const request = await one<{ id: string; status: string; raised_by: string; priority: string }>(
    `select id, status, raised_by as "raised_by", priority from request where id = $1`,
    [requestId],
  );
  if (!request) throw new ApiError(404, 'Request not found.');
  if (request.raised_by !== user.id && !isAdmin(user)) {
    throw new ApiError(403, 'Only the person who raised this request can edit it.');
  }
  if (request.status !== 'returned') {
    throw new ApiError(400, 'Only a request that has been returned for editing can be changed.');
  }

  const priority = (input.priority ?? request.priority) as Priority;
  const needsDetail = priority === 'high' || priority === 'critical';

  if (input.lines) {
    const types = await loadTypeContext(input.lines.map((l) => l.assetTypeId));
    if (types.size !== new Set(input.lines.map((l) => l.assetTypeId)).size) {
      throw new ApiError(400, 'One or more of the chosen assets are not available.');
    }
    await assertMayRequest(types, user.roles);
    for (const line of input.lines) {
      const type = types.get(line.assetTypeId)!;
      if (type.custody_kind === 'location' && !line.recipientRoomId) {
        throw new ApiError(400, `Choose a room for ${type.name}.`);
      }
      if (type.custody_kind === 'person' && line.recipientRoomId) {
        throw new ApiError(400, `${type.name} is assigned to a person, so it cannot be tied to a room.`);
      }
    }

    const issued = await one<{ count: string }>(
      `select count(*)::text as count from request_item ri
         join request_line rl on rl.id = ri.request_line_id
        where rl.request_id = $1 and ri.status not in ('requested','closed')`,
      [requestId],
    );
    if (Number(issued?.count ?? 0) > 0) {
      throw new ApiError(400, 'Items on this request have already moved on, so the lines can no longer be replaced.');
    }

    await withTransaction(async (tx) => {
      await tx.query(`delete from request_line where request_id = $1`, [requestId]);
      for (const line of input.lines!) {
        const lineId = uid();
        await tx.query(
          `insert into request_line (id, request_id, asset_type_id, quantity, recipient_room_id, note)
           values ($1,$2,$3,$4,$5,$6)`,
          [lineId, requestId, line.assetTypeId, line.quantity, line.recipientRoomId ?? null, line.note ?? null],
        );
        if (line.recipients?.length) {
          const total = line.recipients.reduce((s, r) => s + r.quantity, 0);
          if (total !== line.quantity) {
            throw new ApiError(400, 'The people chosen must add up to the requested quantity.');
          }
          let seq = 0;
          for (const person of line.recipients) {
            await tx.query(
              `insert into request_line_recipient (id, request_line_id, staff_id, quantity) values ($1,$2,$3,$4)`,
              [uid(), lineId, person.staffId, person.quantity],
            );
            for (let i = 0; i < person.quantity; i++) {
              seq += 1;
              await tx.query(
                `insert into request_item (id, request_line_id, seq, status, recipient_staff_id)
                 values ($1,$2,$3,'requested',$4)`,
                [uid(), lineId, seq, person.staffId],
              );
            }
          }
        } else {
          for (let i = 0; i < line.quantity; i++) {
            await tx.query(`insert into request_item (id, request_line_id, seq, status) values ($1,$2,$3,'requested')`, [
              uid(),
              lineId,
              i + 1,
            ]);
          }
        }
      }
    });
  }

  await query(
    `update request set justification = coalesce($2, justification), priority = $3,
            priority_justification = $4, business_impact = $5
      where id = $1`,
    [
      requestId,
      input.justification ?? null,
      priority,
      needsDetail ? (input.priorityJustification ?? null) : null,
      needsDetail ? (input.businessImpact ?? null) : null,
    ],
  );

  await addRequestHistory({
    requestId,
    event: 'RequestEdited',
    byStaffId: user.id,
    note: 'The requester updated the request after it was returned for editing.',
  });

  return getRequest(user, requestId);
}

export async function resubmitRequest(user: CurrentUser, requestId: string) {
  const request = await one<{ id: string; ref: string; status: string; raised_by: string; raised_for: string }>(
    `select id, ref, status, raised_by as "raised_by", raised_for as "raised_for" from request where id = $1`,
    [requestId],
  );
  if (!request) throw new ApiError(404, 'Request not found.');
  if (request.raised_by !== user.id && !isAdmin(user)) {
    throw new ApiError(403, 'Only the person who raised this request can resubmit it.');
  }
  if (request.status !== 'returned') throw new ApiError(400, 'This request is not waiting to be resubmitted.');

  const reviewer = await directManager(String(request.raised_for));
  await query(
    `update request set status = $2, current_reviewer_id = $3, resubmitted_at = now(), returned_by = null,
            returned_at = null, return_reason = null
      where id = $1`,
    [requestId, reviewer ? 'under_review' : 'in_progress', reviewer],
  );
  await addRequestHistory({
    requestId,
    event: 'RequestResubmitted',
    byStaffId: user.id,
    note: reviewer
      ? `Resubmitted after editing — back with ${await staffName(reviewer)} for review.`
      : 'Resubmitted after editing — no manager above the requester, so it moved to the stock check.',
  });

  if (!reviewer) {
    const stages = await approvalStagesFor(requestId);
    if (stages.length) {
      await createApprovalStages(requestId, stages);
      await query(`update request set status = 'awaiting_approval' where id = $1`, [requestId]);
      void notifyApprover(requestId, String(request.ref), stages[0].role);
    }
  } else {
    for (const to of await emailsForStaff([reviewer])) {
      void sendMail({
        to,
        subject: `${request.ref} — resubmitted for review`,
        body: mailBody([`${request.ref} was edited and resubmitted. It is waiting for your review again.`, appUrl(`/requests/${requestId}`)]),
        dedupeKey: `request:${requestId}:resubmitted:${reviewer}:${Date.now()}`,
      });
    }
  }

  return getRequest(user, requestId);
}

// ------------------------------------------------------------------
// Queues
// ------------------------------------------------------------------
export async function approvalsQueue(user: CurrentUser) {
  const reviews = await query<Record<string, unknown>>(
    `select r.id, r.ref, r.priority, r.raised_at as "raisedAt", r.justification, r.is_group as "isGroup",
            rb.name as "raisedByName", rf.name as "raisedForName",
            'review' as kind, null::text as "requiredRole",
            (select coalesce(sum(rl.quantity),0) from request_line rl where rl.request_id = r.id)::int as "itemCount",
            (select string_agg(at.name, ', ') from request_line rl join asset_type at on at.id = rl.asset_type_id
              where rl.request_id = r.id) as items,
            (select count(*) from request_history h where h.request_id = r.id and h.event = 'RequestPassedReview')::int as "alreadyPassed"
       from request r
       join staff rb on rb.id = r.raised_by
       join staff rf on rf.id = r.raised_for
      where r.status = 'under_review' and r.current_reviewer_id = $1`,
    [user.id],
  );

  const approvals = user.roles.length
    ? await query<Record<string, unknown>>(
        `select r.id, r.ref, r.priority, r.raised_at as "raisedAt", r.justification, r.is_group as "isGroup",
                rb.name as "raisedByName", rf.name as "raisedForName",
                'approval' as kind, ra.required_role as "requiredRole",
                (select coalesce(sum(rl.quantity),0) from request_line rl where rl.request_id = r.id)::int as "itemCount",
                (select string_agg(at.name, ', ') from request_line rl join asset_type at on at.id = rl.asset_type_id
                  where rl.request_id = r.id) as items,
                0 as "alreadyPassed"
           from request r
           join staff rb on rb.id = r.raised_by
           join staff rf on rf.id = r.raised_for
           join request_approval ra on ra.request_id = r.id and ra.status = 'pending'
          where r.status = 'awaiting_approval' and ra.required_role = any($1::text[])`,
        [user.roles],
      )
    : [];

  const rows = [...reviews, ...approvals].sort((a, b) => {
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const diff = (rank[String(a.priority)] ?? 9) - (rank[String(b.priority)] ?? 9);
    if (diff !== 0) return diff;
    return new Date(String(a.raisedAt)).getTime() - new Date(String(b.raisedAt)).getTime();
  });

  const team = await teamMemberIds(user.id);
  return {
    rows: rows.map((r) => ({ ...r, raisedAt: isoDate(r.raisedAt) })),
    teamSize: team.length,
  };
}
