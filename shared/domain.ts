/**
 * Shared domain vocabulary for I4nnova Asset Management (Release 1).
 * Used by both the API (authorisation) and the UI (navigation, labels).
 */

export type Role = 'team_lead' | 'line_manager' | 'stock_manager' | 'financial_executive' | 'administrator';

export const ROLE_LABELS: Record<Role, string> = {
  team_lead: 'Team Lead',
  line_manager: 'Line Manager',
  stock_manager: 'Stock Manager',
  financial_executive: 'Financial Executive',
  administrator: 'Administrator',
};

export const ALL_ROLES: Role[] = [
  'team_lead',
  'line_manager',
  'stock_manager',
  'financial_executive',
  'administrator',
];

export type RequestStatus =
  | 'raised'
  | 'under_review'
  | 'rejected'
  | 'in_progress'
  | 'fulfilled'
  | 'partly_fulfilled'
  | 'closed'
  | 'cancelled';

export type ItemStatus =
  | 'requested'
  | 'awaiting_quotation'
  | 'awaiting_decision'
  | 'approved'
  | 'parked'
  | 'purchased'
  | 'issued'
  | 'closed';

export type ClosedReason = 'declined' | 'unavailable' | 'cancelled';
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type AssetStatus = 'available' | 'assigned' | 'awaiting_disposal' | 'disposed';
export type CustodyKind = 'person' | 'location';
export type DisposalMethod = 'sale' | 'auction' | 'scrap' | 'donation' | 'recycling';

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  raised: 'Raised',
  under_review: 'Under review',
  rejected: 'Rejected',
  in_progress: 'In progress',
  fulfilled: 'Fulfilled',
  partly_fulfilled: 'Partly fulfilled',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  requested: 'Requested',
  awaiting_quotation: 'Awaiting quotation',
  awaiting_decision: 'Awaiting decision',
  approved: 'Approved',
  parked: 'Parked',
  purchased: 'Purchased',
  issued: 'Issued',
  closed: 'Closed',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  available: 'Available',
  assigned: 'Assigned',
  awaiting_disposal: 'Awaiting disposal approval',
  disposed: 'Disposed',
};

export const DISPOSAL_METHOD_LABELS: Record<DisposalMethod, string> = {
  sale: 'Sale',
  auction: 'Auction',
  scrap: 'Scrap',
  donation: 'Donation',
  recycling: 'Recycling',
};

export const CLOSED_REASON_LABELS: Record<ClosedReason, string> = {
  declined: 'Declined',
  unavailable: 'Unavailable',
  cancelled: 'Cancelled',
};

export const CONDITION_LABELS: Record<'new' | 'good' | 'fair' | 'poor', string> = {
  new: 'New',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

/** Roles allowed to open each module. Read-only access is enforced per action server-side. */
export const NAV_PERMISSIONS = {
  dashboard: ALL_ROLES,
  requests: ALL_ROLES,
  approvals: ['team_lead', 'line_manager', 'administrator'] as Role[],
  stock: ['stock_manager', 'administrator'] as Role[],
  quotations: ['stock_manager', 'financial_executive', 'administrator'] as Role[],
  'financial-approvals': ['financial_executive', 'administrator'] as Role[],
  purchases: ['stock_manager', 'financial_executive', 'administrator'] as Role[],
  assets: ALL_ROLES,
  transfers: ALL_ROLES,
  returns: ALL_ROLES,
  disposals: ['administrator', 'stock_manager'] as Role[],
  staff: ['administrator'] as Role[],
  organisation: ['administrator'] as Role[],
  rooms: ['administrator'] as Role[],
  'asset-types': ['administrator', 'stock_manager'] as Role[],
  reports: ['administrator', 'stock_manager', 'financial_executive', 'line_manager'] as Role[],
  settings: ['administrator'] as Role[],
} satisfies Record<string, Role[]>;

export type NavKey = keyof typeof NAV_PERMISSIONS;

export function canAccess(roles: Role[], key: NavKey): boolean {
  return NAV_PERMISSIONS[key].some((r) => roles.includes(r));
}

/** Request status is derived from its items (never set by hand). */
export function deriveRequestStatus(items: { status: ItemStatus }[]): RequestStatus {
  if (items.length === 0) return 'raised';
  const issued = items.filter((i) => i.status === 'issued').length;
  const open = items.filter((i) => i.status !== 'issued' && i.status !== 'closed').length;
  const closed = items.filter((i) => i.status === 'closed').length;
  if (open > 0) return 'in_progress';
  if (issued === items.length) return 'fulfilled';
  if (issued > 0) return 'partly_fulfilled';
  return closed === items.length ? 'closed' : 'in_progress';
}

export const PRIORITY_BADGE: Record<Priority, string> = {
  critical: 'bg-red-50 text-red-700 ring-red-200',
  high: 'bg-orange-50 text-orange-700 ring-orange-200',
  medium: 'bg-blue-50 text-blue-700 ring-blue-200',
  low: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export const REQUEST_STATUS_BADGE: Record<RequestStatus, string> = {
  raised: 'bg-slate-100 text-slate-700 ring-slate-200',
  under_review: 'bg-amber-50 text-amber-700 ring-amber-200',
  rejected: 'bg-red-50 text-red-700 ring-red-200',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  fulfilled: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  partly_fulfilled: 'bg-violet-50 text-violet-700 ring-violet-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export const ASSET_STATUS_BADGE: Record<AssetStatus, string> = {
  available: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  assigned: 'bg-blue-50 text-blue-700 ring-blue-200',
  awaiting_disposal: 'bg-amber-50 text-amber-700 ring-amber-200',
  disposed: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export type ScoringWeights = { price: number; quality: number; delivery: number; warranty: number };

export const DEFAULT_WEIGHTS: ScoringWeights = { price: 40, quality: 30, delivery: 15, warranty: 15 };

export type ScorableQuote = {
  id: string;
  amount: number;
  qualityRating: number;
  deliveryDays: number;
  warrantyMonths: number;
  recordedAt: string;
};

export type ScoredQuote = ScorableQuote & {
  priceScore: number;
  qualityScore: number;
  deliveryScore: number;
  warrantyScore: number;
  totalScore: number;
  recommended: boolean;
};

/**
 * Quote scoring per PRD: each criterion normalised 0..1, then weighted.
 * Delivery counts in days with a minimum of 1 (same-day delivery = 1 day).
 * Tie-break: lower amount, then earliest recorded.
 */
export function scoreQuotes(quotes: ScorableQuote[], weights: ScoringWeights): ScoredQuote[] {
  if (quotes.length === 0) return [];
  const cheapest = Math.min(...quotes.map((q) => q.amount));
  const fastest = Math.min(...quotes.map((q) => Math.max(1, q.deliveryDays)));
  const longestWarranty = Math.max(...quotes.map((q) => q.warrantyMonths));

  const scored = quotes.map((q) => {
    const priceScore = q.amount > 0 ? cheapest / q.amount : 0;
    const qualityScore = q.qualityRating / 5;
    const delivery = Math.max(1, q.deliveryDays);
    const deliveryScore = fastest / delivery;
    const warrantyScore = longestWarranty > 0 ? q.warrantyMonths / longestWarranty : 0;
    const totalScore =
      (priceScore * weights.price +
        qualityScore * weights.quality +
        deliveryScore * weights.delivery +
        warrantyScore * weights.warranty) /
      100;
    return {
      ...q,
      priceScore,
      qualityScore,
      deliveryScore,
      warrantyScore,
      totalScore: Math.round(totalScore * 10000) / 10000,
      recommended: false,
    };
  });

  const best = [...scored].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (a.amount !== b.amount) return a.amount - b.amount;
    return new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime();
  })[0];
  if (best) best.recommended = true;
  return scored;
}

export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return '₦' + n.toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

export function progressLabel(issued: number, total: number, onOrder: number): string {
  if (total === 0) return '—';
  const parts = [`${issued} of ${total} issued`];
  if (onOrder > 0) parts.push(`${onOrder} on order`);
  return parts.join(', ');
}
