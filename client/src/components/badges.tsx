import {
  ASSET_STATUS_BADGE,
  ASSET_STATUS_LABELS,
  ITEM_STATUS_LABELS,
  PRIORITY_BADGE,
  PRIORITY_LABELS,
  REQUEST_STATUS_BADGE,
  REQUEST_STATUS_LABELS,
  type AssetStatus,
  type ItemStatus,
  type Priority,
  type RequestStatus,
} from '@shared/domain';
import { Badge } from './ui';

const ITEM_BADGE: Record<ItemStatus, string> = {
  requested: 'bg-slate-100 text-slate-700 ring-slate-200',
  awaiting_quotation: 'bg-violet-50 text-violet-700 ring-violet-200',
  awaiting_decision: 'bg-amber-50 text-amber-800 ring-amber-200',
  approved: 'bg-brand-50 text-brand-600 ring-brand-200',
  parked: 'bg-orange-50 text-orange-700 ring-orange-200',
  purchased: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  issued: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  closed: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export function PriorityBadge({ priority }: { priority: Priority | string }) {
  const p = priority as Priority;
  return <Badge className={PRIORITY_BADGE[p] ?? ''} dot>{PRIORITY_LABELS[p] ?? priority}</Badge>;
}

export function RequestStatusBadge({ status }: { status: RequestStatus | string }) {
  const s = status as RequestStatus;
  return <Badge className={REQUEST_STATUS_BADGE[s] ?? ''}>{REQUEST_STATUS_LABELS[s] ?? status}</Badge>;
}

export function ItemStatusBadge({ status, reason }: { status: ItemStatus | string; reason?: string | null }) {
  const s = status as ItemStatus;
  return (
    <Badge className={ITEM_BADGE[s] ?? ''}>
      {ITEM_STATUS_LABELS[s] ?? status}
      {reason ? ` · ${reason}` : ''}
    </Badge>
  );
}

export function AssetStatusBadge({ status }: { status: AssetStatus | string }) {
  const s = status as AssetStatus;
  return <Badge className={ASSET_STATUS_BADGE[s] ?? ''}>{ASSET_STATUS_LABELS[s] ?? status}</Badge>;
}

export function DecisionBadge({ decision }: { decision: string }) {
  const map: Record<string, string> = {
    approve: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    decline: 'bg-red-50 text-red-700 ring-red-200',
    defer: 'bg-amber-50 text-amber-700 ring-amber-200',
  };
  const label: Record<string, string> = { approve: 'Approved', decline: 'Declined', defer: 'Deferred' };
  return <Badge className={map[decision] ?? ''}>{label[decision] ?? decision}</Badge>;
}
