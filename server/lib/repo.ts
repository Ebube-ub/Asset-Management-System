import crypto from 'node:crypto';
import { one, query } from '../db/index.js';
import { deriveRequestStatus, DEFAULT_WEIGHTS, type ItemStatus, type Role, type ScoringWeights } from '../../shared/domain.js';
import type { CurrentUser } from './auth.js';

export function uid(): string {
  return crypto.randomUUID();
}

export function toBool(v: unknown): boolean {
  return v === true || v === 't' || v === 'true';
}

export function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

export async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await one<{ value: string }>(`select value from app_setting where key = $1`, [key]);
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `insert into app_setting (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, value],
  );
}

export type AppSettings = {
  parkedReviewDays: number;
  secondApproverId: string | null;
  secondApproverName: string | null;
  stockReleaseAuthorization: 'required' | 'not_required';
  weights: ScoringWeights;
};

export async function getSettings(): Promise<AppSettings> {
  const [days, approver, releaseAuth] = await Promise.all([
    getSetting('parked_review_days', '7'),
    getSetting('second_approver_id', ''),
    getSetting('stock_release_authorization', 'required'),
  ]);
  const weights = await activeWeights();
  let approverName: string | null = null;
  if (approver) {
    const row = await one<{ name: string }>(`select name from staff where id = $1`, [approver]);
    approverName = row?.name ?? null;
  }
  return {
    parkedReviewDays: Number(days) || 7,
    secondApproverId: approver || null,
    secondApproverName: approverName,
    stockReleaseAuthorization: releaseAuth === 'not_required' ? 'not_required' : 'required',
    weights,
  };
}

export async function activeWeights(): Promise<ScoringWeights> {
  const row = await one<{ price: number; quality: number; delivery: number; warranty: number }>(
    `select price, quality, delivery, warranty from scoring_weights where is_active = true order by effective_from desc limit 1`,
  );
  if (!row) return { ...DEFAULT_WEIGHTS };
  return { price: row.price, quality: row.quality, delivery: row.delivery, warranty: row.warranty };
}

export async function nextRequestRef(): Promise<string> {
  const row = await one<{ n: string }>(`select nextval('request_ref_seq') as n`);
  const year = new Date().getFullYear();
  return `REQ-${year}-${String(Number(row?.n ?? 1)).padStart(4, '0')}`;
}

export async function nextAssetRef(): Promise<string> {
  const row = await one<{ n: string }>(`select nextval('asset_ref_seq') as n`);
  return `AST-${String(Number(row?.n ?? 1)).padStart(5, '0')}`;
}

export async function addRequestHistory(input: {
  requestId: string;
  lineId?: string | null;
  itemId?: string | null;
  event: string;
  byStaffId?: string | null;
  note?: string | null;
}): Promise<void> {
  await query(
    `insert into request_history (id, request_id, request_line_id, request_item_id, event, by_staff_id, note)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      uid(),
      input.requestId,
      input.lineId ?? null,
      input.itemId ?? null,
      input.event,
      input.byStaffId ?? null,
      input.note ?? null,
    ],
  );
}

export async function addAssetHistory(input: {
  assetId: string;
  event: string;
  fromHolder?: string | null;
  toHolder?: string | null;
  byStaffId?: string | null;
  note?: string | null;
}): Promise<void> {
  await query(
    `insert into asset_history (id, asset_id, event, from_holder, to_holder, by_staff_id, note)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      uid(),
      input.assetId,
      input.event,
      input.fromHolder ?? null,
      input.toHolder ?? null,
      input.byStaffId ?? null,
      input.note ?? null,
    ],
  );
}

/** Request status always follows its items once the requisition is being worked. */
export async function recomputeRequestStatus(requestId: string, byStaffId?: string | null): Promise<void> {
  const request = await one<{ id: string; status: string }>(`select id, status from request where id = $1`, [
    requestId,
  ]);
  if (!request) return;
  if (['raised', 'under_review', 'returned', 'awaiting_approval', 'rejected', 'cancelled'].includes(request.status)) return;
  const items = await query<{ status: ItemStatus }>(
    `select ri.status from request_item ri
       join request_line rl on rl.id = ri.request_line_id
      where rl.request_id = $1`,
    [requestId],
  );
  const derived = deriveRequestStatus(items.map((i) => ({ status: i.status })));
  const finalStates = ['fulfilled', 'partly_fulfilled', 'closed'];
  if (request.status === derived) return;
  await query(`update request set status = $2 where id = $1`, [requestId, derived]);
  if (finalStates.includes(derived) && !finalStates.includes(request.status)) {
    await addRequestHistory({
      requestId,
      event: 'RequestCompleted',
      byStaffId: byStaffId ?? null,
      note: `Request ${derived.replace('_', ' ')}.`,
    });
  }
}

/** Managers above a staff member, nearest first. */
export async function managerChain(staffId: string): Promise<string[]> {
  const rows = await query<{ id: string; manager_id: string | null }>(
    `with recursive chain as (
       select s.id, s.manager_id, 0 as depth from staff s where s.id = $1
       union all
       select m.id, m.manager_id, c.depth + 1
         from staff m join chain c on m.id = c.manager_id
        where c.depth < 25
     )
     select id, manager_id from chain where depth > 0 order by depth`,
    [staffId],
  );
  return rows.map((r) => r.id);
}

export async function directManager(staffId: string): Promise<string | null> {
  const row = await one<{ manager_id: string | null; left_at: string | null }>(
    `select manager_id, left_at from staff where id = $1`,
    [staffId],
  );
  if (!row?.manager_id) return null;
  const manager = await one<{ left_at: string | null }>(`select left_at from staff where id = $1`, [row.manager_id]);
  return manager && !manager.left_at ? row.manager_id : null;
}

export async function hasRoleId(staffId: string, role: Role): Promise<boolean> {
  const row = await one(`select 1 from staff_role where staff_id = $1 and role = $2`, [staffId, role]);
  return !!row;
}

/** Everyone whose requests reach this manager, at any depth. */
export async function teamMemberIds(managerId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `with recursive reports as (
       select s.id from staff s where s.manager_id = $1
       union all
       select s.id from staff s join reports r on s.manager_id = r.id
     )
     select distinct id from reports`,
    [managerId],
  );
  return rows.map((r) => r.id);
}

export async function isAboveManager(managerId: string, staffId: string): Promise<boolean> {
  const chain = await managerChain(staffId);
  return chain.includes(managerId);
}

export type RequestAccess = {
  canView: boolean;
  isRequester: boolean;
  isRecipient: boolean;
  isReviewer: boolean;
  canReview: boolean;
};

export async function requestAccess(user: CurrentUser, requestId: string): Promise<RequestAccess | null> {
  const request = await one<{ raised_by: string; raised_for: string; current_reviewer_id: string | null; status: string }>(
    `select raised_by, raised_for, current_reviewer_id, status from request where id = $1`,
    [requestId],
  );
  if (!request) return null;
  // A member of a group request can always see the line addressed to them.
  const isGroupRecipient = !!(await one(
    `select 1 from request_item ri
       join request_line rl on rl.id = ri.request_line_id
      where rl.request_id = $1 and ri.recipient_staff_id = $2 limit 1`,
    [requestId, user.id],
  ));
  const isAdmin = user.roles.includes('administrator');
  const isStock = user.roles.includes('stock_manager');
  const isFinance = user.roles.includes('financial_executive');
  const isRequester = request.raised_by === user.id;
  const isRecipient = request.raised_for === user.id;
  const isReviewer = request.current_reviewer_id === user.id;
  let isInChain = false;
  if (user.roles.includes('team_lead') || user.roles.includes('line_manager')) {
    isInChain = await isAboveManager(user.id, request.raised_for);
  }
  const canReview = isReviewer && request.status === 'under_review';
  return {
    canView:
      isAdmin || isStock || isFinance || isRequester || isRecipient || isReviewer || isInChain || isGroupRecipient,
    isRequester,
    isRecipient,
    isReviewer,
    canReview,
  };
}

export async function pickRandom<T>(items: T[]): Promise<T> {
  return items[Math.floor(Math.random() * items.length)];
}
