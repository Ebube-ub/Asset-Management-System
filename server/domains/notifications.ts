import { one, query } from '../db/index.js';
import type { CurrentUser } from '../lib/auth.js';
import { iso } from '../lib/repo.js';

/** Human labels for the recorded events, shared by the bell and the dashboard feed. */
const EVENT_LABELS: Record<string, string> = {
  RequestRaised: 'Request raised',
  RequestPassedReview: 'Passed to the next reviewer',
  RequestRejected: 'Request rejected',
  RequestCancelled: 'Request cancelled',
  RequestCompleted: 'Request completed',
  StockChecked: 'Stock checked',
  ItemIssued: 'Items issued',
  ItemClosed: 'Item closed',
  ItemRequoted: 'Item sent back for quotations',
  QuoteRecorded: 'Quotations recorded',
  QuoteChosen: 'Quotation chosen',
  FinancialDecisionRecorded: 'Financial decision recorded',
  PurchaseRecorded: 'Purchase recorded',
  AssetRegistered: 'Asset registered',
  AssetAssigned: 'Asset assigned',
  AssetTransferred: 'Asset transferred',
  AssetReturned: 'Asset returned',
  ReturnRequested: 'Return requested',
  TransferRequested: 'Transfer requested',
  DisposalProposed: 'Disposal proposed',
  DisposalApproved: 'Disposal approved',
  DisposalRejected: 'Disposal rejected',
  AssetDisposed: 'Asset disposed',
};

type FeedRow = {
  id: string;
  kind: 'request' | 'asset';
  event: string;
  at: string;
  note: string | null;
  actor: string | null;
  ref: string | null;
  requestId: string | null;
  assetId: string | null;
};

export async function notificationFeed(user: CurrentUser) {
  const wide = user.roles.some((r) => r === 'administrator' || r === 'stock_manager' || r === 'financial_executive');

  // Events on requests the user raised, holds or reviews, and on assets they hold.
  // Administrators, the stock manager and the financial executive work across the org.
  const events = await query<FeedRow>(
    `select * from (
       select h.id, 'request' as kind, h.event, h.at, h.note,
              s.name as actor, r.ref, r.id as "requestId", null::uuid as "assetId"
         from request_history h
         join request r on r.id = h.request_id
         left join staff s on s.id = h.by_staff_id
        where $2 or r.raised_by = $1 or r.raised_for = $1 or r.current_reviewer_id = $1 or h.by_staff_id = $1
       union all
       select h.id, 'asset' as kind, h.event, h.at, h.note,
              s.name as actor, a.ref, null::uuid as "requestId", a.id as "assetId"
         from asset_history h
         join asset a on a.id = h.asset_id
         left join staff s on s.id = h.by_staff_id
        where $2 or a.holder_staff_id = $1 or h.by_staff_id = $1
     ) e
     order by at desc
     limit 30`,
    [user.id, wide],
  );

  const lastRead = await one<{ at: string }>(
    `select last_read_at as at from notification_read where staff_id = $1`,
    [user.id],
  );
  const readAt = lastRead?.at ? new Date(lastRead.at).getTime() : Date.now() - 3 * 24 * 60 * 60 * 1000;

  const items = events.map((e) => ({
    id: e.id,
    kind: e.kind,
    event: e.event,
    title: EVENT_LABELS[e.event] ?? e.event,
    note: e.note,
    actor: e.actor,
    ref: e.ref,
    at: iso(e.at),
    read: new Date(e.at).getTime() <= readAt,
    href: e.requestId ? `/requests/${e.requestId}` : e.assetId ? `/assets/${e.assetId}` : '/dashboard',
  }));

  const counts = await one<Record<string, number>>(
    `select
       (select count(*)::int from request where current_reviewer_id = $1 and status = 'under_review') as "review",
       (select count(*)::int from request_item where status = 'requested') as "stockChecks",
       (select count(*)::int from request_item where status = 'awaiting_quotation') as "quotations",
       (select count(*)::int from request_item where status = 'awaiting_decision') as "decisions",
       (select count(*)::int from request_item where status = 'approved') as "purchases",
       (select count(*)::int from asset_movement where status = 'pending') as "movements",
       (select count(*)::int from disposal where status = 'pending') as "disposals"`,
    [user.id],
  );

  const role = (r: string) => user.roles.includes(r as never);
  const digests: { key: string; label: string; description: string; count: number; href: string }[] = [];
  const add = (key: string, label: string, description: string, count: number | undefined, href: string) => {
    if (count && count > 0) digests.push({ key, label, description, count, href });
  };

  if (role('administrator') || role('team_lead') || role('line_manager')) {
    add('review', 'Requests waiting for your review', 'They are with you in the reporting chain', counts?.review, '/approvals');
  }
  if (role('administrator') || role('stock_manager')) {
    add('stock', 'Stock checks waiting', 'Requested items not checked yet', counts?.stockChecks, '/stock');
    add('quotes', 'Quotations outstanding', 'Items waiting for vendor quotations', counts?.quotations, '/quotations');
    add('purchases', 'Purchases to record', 'Approved items still to buy', counts?.purchases, '/purchases');
    add('movements', 'Transfers and returns', 'Movements awaiting confirmation', counts?.movements, '/transfers');
    add('disposals', 'Disposals to decide', 'Assets proposed for disposal', counts?.disposals, '/disposals');
  }
  if (role('administrator') || role('financial_executive')) {
    add('decisions', 'Financial decisions', 'Items awaiting approve, decline or defer', counts?.decisions, '/financial-approvals');
  }

  return {
    items,
    unread: items.filter((i) => !i.read).length,
    digests,
    readAt: iso(lastRead?.at ?? null),
  };
}

export async function markNotificationsRead(user: CurrentUser) {
  await query(
    `insert into notification_read (staff_id, last_read_at) values ($1, now())
     on conflict (staff_id) do update set last_read_at = now()`,
    [user.id],
  );
  return { ok: true, readAt: new Date().toISOString() };
}
