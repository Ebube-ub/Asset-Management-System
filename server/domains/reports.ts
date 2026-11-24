import { query } from '../db/index.js';
import { ApiError } from '../lib/http.js';
import { iso } from '../lib/repo.js';

export type ReportColumn = { key: string; label: string; type?: 'money' | 'date' | 'status' | 'number' };
export type ReportDefinition = {
  key: string;
  title: string;
  description: string;
  group: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
};

export const REPORT_CATALOGUE = [
  { key: 'asset-register', title: 'Asset register', description: 'Every asset, its status and where it is held.', group: 'Assets' },
  { key: 'available-assets', title: 'Available assets', description: 'Assets in stock and ready to issue.', group: 'Assets' },
  { key: 'assigned-assets', title: 'Assigned assets', description: 'Assets held by staff or placed in rooms.', group: 'Assets' },
  { key: 'assets-by-type', title: 'Assets by type', description: 'Stock levels across every asset type.', group: 'Assets' },
  { key: 'assets-by-location', title: 'Assets by location', description: 'What is held in each room.', group: 'Assets' },
  { key: 'assets-by-staff', title: 'Assets by staff member', description: 'Who holds what.', group: 'Assets' },
  { key: 'requests-by-status', title: 'Requests by status', description: 'Request volume by lifecycle status.', group: 'Requests' },
  { key: 'requests-by-priority', title: 'Requests by priority', description: 'Request volume by priority.', group: 'Requests' },
  { key: 'financial-approvals', title: 'Financial approvals', description: 'Every financial decision with its amount.', group: 'Finance' },
  { key: 'purchase-costs', title: 'Purchase costs', description: 'Recorded purchases against approved amounts.', group: 'Finance' },
  { key: 'over-budget-purchases', title: 'Over-budget purchases', description: 'Purchases that cost more than the approved amount.', group: 'Finance' },
  { key: 'vendor-quotations', title: 'Vendor quotations', description: 'Quotations recorded, with quality ratings.', group: 'Finance' },
  { key: 'asset-transfers', title: 'Asset transfers', description: 'Every confirmed transfer between holders.', group: 'Movements' },
  { key: 'returns', title: 'Returns', description: 'Assets returned to stock.', group: 'Movements' },
  { key: 'disposals', title: 'Disposals', description: 'Disposal proposals and their outcomes.', group: 'Movements' },
] as const;

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  assigned: 'Assigned',
  awaiting_disposal: 'Awaiting disposal',
  disposed: 'Disposed',
  raised: 'Raised',
  under_review: 'Under review',
  in_progress: 'In progress',
  fulfilled: 'Fulfilled',
  partly_fulfilled: 'Partly fulfilled',
  closed: 'Closed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
  approve: 'Approved',
  decline: 'Declined',
  defer: 'Deferred',
  pending: 'Pending',
  completed: 'Completed',
  approved: 'Approved',
};

const titleCase = (v: unknown) => STATUS_LABEL[String(v)] ?? String(v ?? '').replace(/_/g, ' ');

export async function runReport(key: string): Promise<ReportDefinition> {
  const def = REPORT_CATALOGUE.find((r) => r.key === key);
  if (!def) throw new ApiError(404, 'Report not found.');

  const base = { key: def.key, title: def.title, description: def.description, group: def.group };

  const simple = async (
    columns: ReportColumn[],
    rows: Record<string, unknown>[],
  ): Promise<ReportDefinition> => ({ ...base, columns, rows });

  switch (key) {
    case 'asset-register': {
      const rows = await query(
        `select a.ref, at.name as "type", coalesce(a.serial_number,'—') as "serial", a.condition,
                a.status, coalesce(s.name, rm.name, 'In stock') as "heldBy",
                to_char(a.registered_at,'YYYY-MM-DD') as "registered"
           from asset a join asset_type at on at.id = a.asset_type_id
           left join staff s on s.id = a.holder_staff_id
           left join room rm on rm.id = a.room_id
          order by a.ref`,
      );
      return simple(
        [
          { key: 'ref', label: 'Asset ID' },
          { key: 'type', label: 'Asset type' },
          { key: 'serial', label: 'Serial number' },
          { key: 'condition', label: 'Condition' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'heldBy', label: 'Held by' },
          { key: 'registered', label: 'Registered', type: 'date' },
        ],
        rows.map((r) => ({ ...r, condition: titleCase(r.condition), status: titleCase(r.status) })),
      );
    }
    case 'available-assets': {
      const rows = await query(
        `select a.ref, at.name as "type", at.custody_kind as "custody", coalesce(a.serial_number,'—') as "serial",
                a.condition, to_char(a.registered_at,'YYYY-MM-DD') as "registered"
           from asset a join asset_type at on at.id = a.asset_type_id
          where a.status = 'available' order by at.name, a.ref`,
      );
      return simple(
        [
          { key: 'ref', label: 'Asset ID' },
          { key: 'type', label: 'Asset type' },
          { key: 'custody', label: 'Custody' },
          { key: 'serial', label: 'Serial number' },
          { key: 'condition', label: 'Condition' },
          { key: 'registered', label: 'Registered', type: 'date' },
        ],
        rows.map((r) => ({ ...r, custody: r.custody === 'person' ? 'Person' : 'Location', condition: titleCase(r.condition) })),
      );
    }
    case 'assigned-assets': {
      const rows = await query(
        `select a.ref, at.name as "type", coalesce(s.name,'—') as "person", coalesce(rm.name,'—') as "room",
                to_char(a.registered_at,'YYYY-MM-DD') as "assigned"
           from asset a join asset_type at on at.id = a.asset_type_id
           left join staff s on s.id = a.holder_staff_id
           left join room rm on rm.id = a.room_id
          where a.status = 'assigned' order by at.name, a.ref`,
      );
      return simple(
        [
          { key: 'ref', label: 'Asset ID' },
          { key: 'type', label: 'Asset type' },
          { key: 'person', label: 'Held by (person)' },
          { key: 'room', label: 'Held by (room)' },
          { key: 'assigned', label: 'Since', type: 'date' },
        ],
        rows,
      );
    }
    case 'assets-by-type': {
      const rows = await query(
        `select at.name as "type", at.custody_kind as "custody",
                count(a.id)::int as "total",
                count(a.id) filter (where a.status = 'available')::int as "available",
                count(a.id) filter (where a.status = 'assigned')::int as "assigned",
                count(a.id) filter (where a.status = 'awaiting_disposal')::int as "awaitingDisposal",
                count(a.id) filter (where a.status = 'disposed')::int as "disposed"
           from asset_type at left join asset a on a.asset_type_id = at.id
          group by at.id, at.name, at.custody_kind order by at.name`,
      );
      return simple(
        [
          { key: 'type', label: 'Asset type' },
          { key: 'custody', label: 'Custody' },
          { key: 'total', label: 'Total', type: 'number' },
          { key: 'available', label: 'Available', type: 'number' },
          { key: 'assigned', label: 'Assigned', type: 'number' },
          { key: 'awaitingDisposal', label: 'Awaiting disposal', type: 'number' },
          { key: 'disposed', label: 'Disposed', type: 'number' },
        ],
        rows.map((r) => ({ ...r, custody: r.custody === 'person' ? 'Person' : 'Location' })),
      );
    }
    case 'assets-by-location': {
      const rows = await query(
        `select rm.name as "room", coalesce(rm.building,'—') as "building", count(a.id)::int as "count"
           from room rm left join asset a on a.room_id = rm.id and a.status = 'assigned'
          group by rm.id, rm.name, rm.building order by count desc`,
      );
      return simple(
        [
          { key: 'room', label: 'Room' },
          { key: 'building', label: 'Building' },
          { key: 'count', label: 'Assets held', type: 'number' },
        ],
        rows,
      );
    }
    case 'assets-by-staff': {
      const rows = await query(
        `select s.name as "staff", s.email, s.job_title as "jobTitle", count(a.id)::int as "count",
                coalesce(string_agg(a.ref, ', '), '—') as "assets"
           from staff s left join asset a on a.holder_staff_id = s.id and a.status = 'assigned'
          where s.left_at is null
          group by s.id, s.name, s.email, s.job_title order by count desc, s.name`,
      );
      return simple(
        [
          { key: 'staff', label: 'Staff member' },
          { key: 'email', label: 'Email' },
          { key: 'jobTitle', label: 'Job title' },
          { key: 'count', label: 'Assets held', type: 'number' },
          { key: 'assets', label: 'Asset IDs' },
        ],
        rows,
      );
    }
    case 'requests-by-status': {
      const rows = await query(
        `select r.status, count(distinct r.id)::int as "requests",
                coalesce(count(ri.id),0)::int as "items"
           from request r
           left join request_line rl on rl.request_id = r.id
           left join request_item ri on ri.request_line_id = rl.id
          group by r.status order by r.status`,
      );
      return simple(
        [
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'requests', label: 'Requests', type: 'number' },
          { key: 'items', label: 'Items', type: 'number' },
        ],
        rows.map((r) => ({ ...r, status: titleCase(r.status) })),
      );
    }
    case 'requests-by-priority': {
      const rows = await query(
        `select r.priority,
                count(distinct r.id)::int as "requests",
                count(distinct r.id) filter (where r.status in ('fulfilled','partly_fulfilled'))::int as "completed",
                count(distinct r.id) filter (where r.status in ('under_review','in_progress'))::int as "open"
           from request r group by r.priority
          order by case r.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
      );
      return simple(
        [
          { key: 'priority', label: 'Priority', type: 'status' },
          { key: 'requests', label: 'Requests', type: 'number' },
          { key: 'open', label: 'Open', type: 'number' },
          { key: 'completed', label: 'Completed', type: 'number' },
        ],
        rows.map((r) => ({ ...r, priority: titleCase(r.priority) })),
      );
    }
    case 'financial-approvals': {
      const rows = await query(
        `select r.ref, at.name as "type", fd.decision, fd.approved_amount::float8 as "amount",
                s.name as "decidedBy", to_char(fd.decided_at,'YYYY-MM-DD') as "decidedAt",
                coalesce(fd.note,'—') as "note"
           from financial_decision fd
           join request_line rl on rl.id = fd.request_line_id
           join request r on r.id = rl.request_id
           join asset_type at on at.id = rl.asset_type_id
           join staff s on s.id = fd.decided_by
          order by fd.decided_at desc`,
      );
      return simple(
        [
          { key: 'ref', label: 'Request' },
          { key: 'type', label: 'Asset type' },
          { key: 'decision', label: 'Decision', type: 'status' },
          { key: 'amount', label: 'Approved amount', type: 'money' },
          { key: 'decidedBy', label: 'Decided by' },
          { key: 'decidedAt', label: 'Decided', type: 'date' },
          { key: 'note', label: 'Note' },
        ],
        rows.map((r) => ({ ...r, decision: titleCase(r.decision) })),
      );
    }
    case 'purchase-costs':
    case 'over-budget-purchases': {
      const where = key === 'over-budget-purchases'
        ? `where p.cost > coalesce((select approved_amount from financial_decision f
             where f.request_line_id = p.request_line_id and f.decision = 'approve'
             order by f.decided_at desc limit 1), 0)`
        : '';
      const rows = await query(
        `select r.ref, p.vendor_name as "vendor", at.name as "type", p.cost::float8 as "cost",
                coalesce(fd.approved_amount,0)::float8 as "approved",
                (p.cost - coalesce(fd.approved_amount,0))::float8 as "difference",
                to_char(p.recorded_at,'YYYY-MM-DD') as "recorded"
           from purchase p
           join request_line rl on rl.id = p.request_line_id
           join request r on r.id = rl.request_id
           join asset_type at on at.id = rl.asset_type_id
           left join lateral (
             select approved_amount from financial_decision f
              where f.request_line_id = p.request_line_id and f.decision = 'approve'
              order by f.decided_at desc limit 1
           ) fd on true
           ${where}
          order by p.recorded_at desc`,
      );
      return simple(
        [
          { key: 'ref', label: 'Request' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'type', label: 'Asset type' },
          { key: 'cost', label: 'Actual cost', type: 'money' },
          { key: 'approved', label: 'Approved amount', type: 'money' },
          { key: 'difference', label: 'Difference', type: 'money' },
          { key: 'recorded', label: 'Recorded', type: 'date' },
        ],
        rows,
      );
    }
    case 'vendor-quotations': {
      const rows = await query(
        `select q.vendor_name as "vendor", count(*)::int as "quotes",
                sum(q.amount)::float8 as "value", round(avg(q.quality_rating)::numeric, 1)::float8 as "quality",
                round(avg(q.delivery_days)::numeric, 1)::float8 as "delivery",
                round(avg(q.warranty_months)::numeric, 1)::float8 as "warranty"
           from quote q group by q.vendor_name order by q.vendor_name`,
      );
      return simple(
        [
          { key: 'vendor', label: 'Vendor' },
          { key: 'quotes', label: 'Quotations', type: 'number' },
          { key: 'value', label: 'Total quoted', type: 'money' },
          { key: 'quality', label: 'Avg quality', type: 'number' },
          { key: 'delivery', label: 'Avg delivery (days)', type: 'number' },
          { key: 'warranty', label: 'Avg warranty (months)', type: 'number' },
        ],
        rows,
      );
    }
    case 'asset-transfers':
    case 'returns': {
      const kind = key === 'returns' ? 'return' : 'transfer';
      const rows = await query(
        `select a.ref, at.name as "type", coalesce(h.from_holder,'—') as "from",
                coalesce(h.to_holder, 'Stock') as "to", coalesce(s.name,'System') as "by",
                to_char(h.at,'YYYY-MM-DD') as "date", coalesce(h.note,'—') as "note"
           from asset_history h join asset a on a.id = h.asset_id
           join asset_type at on at.id = a.asset_type_id
           left join staff s on s.id = h.by_staff_id
          where h.event = $1 order by h.at desc`,
        [kind === 'return' ? 'AssetReturned' : 'AssetTransferred'],
      );
      return simple(
        [
          { key: 'ref', label: 'Asset ID' },
          { key: 'type', label: 'Asset type' },
          { key: 'from', label: 'From' },
          { key: 'to', label: 'To' },
          { key: 'by', label: 'Confirmed by' },
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'note', label: 'Note' },
        ],
        rows,
      );
    }
    case 'disposals': {
      const rows = await query(
        `select a.ref, at.name as "type", d.method, d.status, d.reason,
                p.name as "proposedBy", to_char(d.proposed_at,'YYYY-MM-DD') as "proposed",
                coalesce(d.buyer,'—') as "buyer",
                d.proceeds::float8 as "proceeds",
                coalesce(dec.name,'—') as "decidedBy"
           from disposal d
           join asset a on a.id = d.asset_id
           join asset_type at on at.id = a.asset_type_id
           join staff p on p.id = d.proposed_by
           left join staff dec on dec.id = d.decided_by
          order by d.proposed_at desc`,
      );
      return simple(
        [
          { key: 'ref', label: 'Asset ID' },
          { key: 'type', label: 'Asset type' },
          { key: 'method', label: 'Method' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'reason', label: 'Reason' },
          { key: 'proposedBy', label: 'Proposed by' },
          { key: 'proposed', label: 'Proposed', type: 'date' },
          { key: 'buyer', label: 'Buyer' },
          { key: 'proceeds', label: 'Amount received', type: 'money' },
          { key: 'decidedBy', label: 'Decided by' },
        ],
        rows.map((r) => ({ ...r, method: titleCase(r.method), status: titleCase(r.status) })),
      );
    }
    default:
      throw new ApiError(404, 'Report not found.');
  }
}

export async function reportsIndex() {
  return { reports: REPORT_CATALOGUE, generatedAt: iso(new Date()) };
}
