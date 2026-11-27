import { one, query } from '../db/index.js';
import type { CurrentUser } from '../lib/auth.js';
import { getSettings, iso } from '../lib/repo.js';

export async function dashboard(user: CurrentUser) {
  const settings = await getSettings();
  const isAdmin = user.roles.includes('administrator');
  const isStock = user.roles.includes('stock_manager');
  const isFinance = user.roles.includes('financial_executive');
  const isManager = user.roles.includes('team_lead') || user.roles.includes('line_manager');

  const assetCounts = await one<Record<string, number>>(
    `select
       count(*)::int as "total",
       count(*) filter (where status = 'available')::int as "available",
       count(*) filter (where status = 'assigned')::int as "assigned",
       count(*) filter (where status = 'awaiting_disposal')::int as "awaitingDisposal",
       count(*) filter (where status = 'disposed')::int as "disposed"
     from asset`,
  );

  const staffCounts = await one<Record<string, number>>(
    `select count(*) filter (where left_at is null)::int as "staff",
            count(*) filter (where left_at is not null)::int as "left" from staff`,
  );

  const requestCounts = await one<Record<string, number>>(
    `select
       count(*) filter (where status = 'under_review')::int as "pendingReview",
       count(*) filter (where status = 'awaiting_approval')::int as "awaitingApproval",
       count(*) filter (where status = 'returned')::int as "returned",
       count(*) filter (where status = 'in_progress')::int as "inProgress",
       count(*) filter (where status = 'raised')::int as "raised",
       count(*) filter (where status = 'fulfilled')::int as "fulfilled",
       count(*) filter (where status in ('rejected','closed','cancelled'))::int as "closed",
       count(*) filter (where priority in ('high','critical') and status not in ('fulfilled','closed','rejected','cancelled'))::int as "highPriority",
       count(*)::int as "total"
     from request`,
  );

  const itemCounts = await one<Record<string, number>>(
    `select
       count(*) filter (where status = 'requested')::int as "requested",
       count(*) filter (where status = 'awaiting_quotation')::int as "awaitingQuotation",
       count(*) filter (where status = 'awaiting_decision')::int as "awaitingDecision",
       count(*) filter (where status = 'approved')::int as "approved",
       count(*) filter (where status = 'parked')::int as "parked",
       count(*) filter (where status = 'parked' and review_due_at < now())::int as "dueForReview",
       count(*) filter (where status = 'purchased')::int as "purchased",
       count(*) filter (where status = 'issued')::int as "issued",
       count(*) filter (where status = 'closed')::int as "closed"
     from request_item`,
  );

  const byPriority = await query<Record<string, unknown>>(
    `select priority, count(*)::int as count from request
      where status not in ('closed','cancelled','rejected') group by priority`,
  );

  const myRequests = await query<Record<string, unknown>>(
    `select r.id, r.ref, r.status, r.priority, r.raised_at as "raisedAt", rf.name as "raisedForName",
            (select string_agg(at.name, ', ') from request_line rl join asset_type at on at.id = rl.asset_type_id
              where rl.request_id = r.id) as items,
            (select coalesce(sum(rl.quantity),0) from request_line rl where rl.request_id = r.id)::int as "itemCount",
            (select count(*) from request_item ri join request_line rl on rl.id = ri.request_line_id
              where rl.request_id = r.id and ri.status = 'issued')::int as "issuedCount"
       from request r join staff rf on rf.id = r.raised_for
      where r.raised_by = $1 or r.raised_for = $1
      order by r.raised_at desc limit 6`,
    [user.id],
  );

  const myAssets = await query<Record<string, unknown>>(
    `select a.id, a.ref, a.status, at.name as "assetTypeName", a.serial_number as "serialNumber"
       from asset a join asset_type at on at.id = a.asset_type_id
      where a.holder_staff_id = $1 order by at.name`,
    [user.id],
  );

  const myStatusCounts = await one<Record<string, number>>(
    `select
       count(*) filter (where status = 'under_review')::int as "underReview",
       count(*) filter (where status = 'awaiting_approval')::int as "awaitingApproval",
       count(*) filter (where status = 'returned')::int as "returned",
       count(*) filter (where status = 'in_progress')::int as "inProgress",
       count(*) filter (where status = 'fulfilled')::int as "fulfilled",
       count(*) filter (where status in ('partly_fulfilled','closed','rejected','cancelled'))::int as "closed",
       count(*)::int as "total"
     from request where raised_by = $1 or raised_for = $1`,
    [user.id],
  );

  const reviewQueue = await one<{ count: number }>(
    `select
       (select count(*)::int from request where current_reviewer_id = $1 and status = 'under_review')
       + (select count(*)::int from request_approval ra join request r on r.id = ra.request_id
           where ra.status = 'pending' and r.status = 'awaiting_approval'
             and ra.required_role = any($2::text[])) as count`,
    [user.id, user.roles],
  );

  const teamSize = await one<{ count: number }>(
    `with recursive reports as (
       select s.id from staff s where s.manager_id = $1
       union all select s.id from staff s join reports r on s.manager_id = r.id
     ) select count(*)::int as count from reports`,
    [user.id],
  );

  const activity = await query<Record<string, unknown>>(
    `select h.id, h.event, h.at, h.note, s.name as "byName", r.ref, r.id as "requestId"
       from request_history h
       join request r on r.id = h.request_id
       left join staff s on s.id = h.by_staff_id
      order by h.at desc limit 8`,
  );

  const assetActivity = await query<Record<string, unknown>>(
    `select h.id, h.event, h.at, h.note, s.name as "byName", a.ref, a.id as "assetId"
       from asset_history h join asset a on a.id = h.asset_id
       left join staff s on s.id = h.by_staff_id
      order by h.at desc limit 6`,
  );

  const recentRequests = await query<Record<string, unknown>>(
    `select r.id, r.ref, r.priority, r.status, r.raised_at as "raisedAt", r.justification,
            rf.name as "raisedForName",
            (select string_agg(at.name, ', ') from request_line rl join asset_type at on at.id = rl.asset_type_id
              where rl.request_id = r.id) as items,
            (select coalesce(sum(rl.quantity),0) from request_line rl where rl.request_id = r.id)::int as "itemCount"
       from request r join staff rf on rf.id = r.raised_for
      order by r.raised_at desc limit 6`,
  );

  const myActivity = await query<Record<string, unknown>>(
    `select h.id, h.event, h.at, h.note, s.name as "byName", r.ref, r.id as "requestId"
       from request_history h join request r on r.id = h.request_id
       left join staff s on s.id = h.by_staff_id
      where r.raised_by = $1 or r.raised_for = $1
      order by h.at desc limit 6`,
    [user.id],
  );

  const topCategories = await query<Record<string, unknown>>(
    `select coalesce(c.name, at.category) as name, count(a.id)::int as count
       from asset a join asset_type at on at.id = a.asset_type_id
       left join asset_category c on c.id = at.category_id
      group by coalesce(c.name, at.category) order by count desc limit 5`,
  );

  const monthly = await query<Record<string, unknown>>(
    `select to_char(date_trunc('month', raised_at), 'Mon') as label,
            date_trunc('month', raised_at) as month,
            count(*)::int as requests,
            count(*) filter (where status in ('fulfilled','partly_fulfilled'))::int as fulfilled
       from request
      where raised_at > now() - interval '6 months'
      group by 1, 2 order by 2`,
  );

  const spending = await one<Record<string, number>>(
    `select
       coalesce(sum(approved_amount),0)::float8 as "approved",
       (select coalesce(sum(cost),0)::float8 from purchase) as "spent",
       (select count(*)::int from purchase p
         where p.cost > (select approved_amount from financial_decision f
                          where f.request_line_id = p.request_line_id and f.decision = 'approve'
                          order by f.decided_at desc limit 1)) as "overBudget",
       (select count(*)::int from financial_decision where decision = 'decline')::int as "declined",
       (select count(*)::int from financial_decision where decision = 'defer')::int as "deferred"
     from financial_decision where decision = 'approve'`,
  );

  const pendingMovements = await one<{ count: number }>(
    `select count(*)::int as count from asset_movement where status = 'pending'`,
  );
  const pendingDisposals = await one<{ count: number }>(
    `select count(*)::int from disposal where status = 'pending'`,
  );

  const outstanding = [
    {
      key: 'stock',
      label: 'Stock checks waiting',
      description: 'Requested items the stock manager has not checked yet',
      count: itemCounts?.requested ?? 0,
      href: '/stock',
      tone: 'blue',
      roles: ['stock_manager', 'administrator'],
    },
    {
      key: 'quotes',
      label: 'Quotations outstanding',
      description: 'Items waiting for vendor quotations',
      count: itemCounts?.awaitingQuotation ?? 0,
      href: '/quotations',
      tone: 'violet',
      roles: ['stock_manager', 'administrator'],
    },
    {
      key: 'finance',
      label: 'Financial decisions',
      description: 'Items awaiting approve, decline or defer',
      count: itemCounts?.awaitingDecision ?? 0,
      href: '/financial-approvals',
      tone: 'amber',
      roles: ['financial_executive', 'administrator'],
    },
    {
      key: 'purchases',
      label: 'Purchases to record',
      description: 'Approved items with a manual purchase outstanding',
      count: itemCounts?.approved ?? 0,
      href: '/purchases',
      tone: 'emerald',
      roles: ['stock_manager', 'administrator'],
    },
    {
      key: 'movements',
      label: 'Transfers and returns',
      description: 'Movements waiting for the stock manager to confirm',
      count: pendingMovements?.count ?? 0,
      href: '/transfers',
      tone: 'blue',
      roles: ['stock_manager', 'administrator'],
    },
    {
      key: 'disposals',
      label: 'Disposals to approve',
      description: 'Assets proposed for disposal',
      count: pendingDisposals?.count ?? 0,
      href: '/disposals',
      tone: 'red',
      roles: ['stock_manager', 'administrator'],
    },
    {
      key: 'reviews',
      label: 'Requests to review',
      description: 'Requests waiting for your line-manager review',
      count: reviewQueue?.count ?? 0,
      href: '/approvals',
      tone: 'blue',
      roles: ['team_lead', 'line_manager'],
    },
  ].filter((o) => {
    if (isAdmin) return true;
    return o.roles.some((r) => user.roles.includes(r as never));
  });

  return {
    role: isAdmin ? 'administrator' : isStock ? 'stock_manager' : isFinance ? 'financial_executive' : isManager ? 'manager' : 'staff',
    greeting: user.name.split(' ')[0],
    settings: {
      parkedReviewDays: settings.parkedReviewDays,
      secondApproverName: settings.secondApproverName,
    },
    metrics: {
      assets: assetCounts,
      staff: staffCounts,
      requests: requestCounts,
      items: itemCounts,
      spending,
    },
    byPriority,
    monthly: monthly.map((m) => ({
      label: m.label,
      requests: m.requests,
      fulfilled: m.fulfilled,
      month: iso(m.month),
    })),
    topCategories,
    activity: activity.map((a) => ({ ...a, at: iso(a.at) })),
    assetActivity: assetActivity.map((a) => ({ ...a, at: iso(a.at) })),
    myActivity: myActivity.map((a) => ({ ...a, at: iso(a.at) })),
    myRequests: myRequests.map((r) => ({ ...r, raisedAt: iso(r.raisedAt) })),
    recentRequests: recentRequests.map((r) => ({ ...r, raisedAt: iso(r.raisedAt) })),
    myAssets,
    myStatusCounts,
    reviewQueue: reviewQueue?.count ?? 0,
    teamSize: teamSize?.count ?? 0,
    outstanding: outstanding.map((o) => ({ ...o, count: Number(o.count) })),
  };
}
