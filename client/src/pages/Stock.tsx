import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Boxes, HandCoins, PackageCheck, PackagePlus, PackageSearch, Send, Truck } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Select,
  Spinner,
  cn,
  useToast,
} from '../components/ui';
import { PriorityBadge } from '../components/badges';
import { HANDOVER_LABELS } from '@shared/domain';
import { relativeTime, shortDate } from '../lib/format';

export function StockPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { push } = useToast();
  const query = useQuery({ queryKey: ['stock'], queryFn: () => api<any>('/stock') });
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<any>('/meta') });
  const handovers = useQuery({
    queryKey: ['stock-handovers'],
    queryFn: () => api<any>('/assets?status=assigned&pageSize=50&sort=registeredAt&dir=asc'),
  });

  const [issueLine, setIssueLine] = useState<any | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [authorizedById, setAuthorizedById] = useState('');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['stock'] });
    void qc.invalidateQueries({ queryKey: ['stock-handovers'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['requests'] });
    void qc.invalidateQueries({ queryKey: ['assets'] });
  };

  const issue = useMutation({
    mutationFn: (payload: any) => api<any>(`/stock/lines/${issueLine.lineId}/issue`, { method: 'POST', body: payload }),
    onSuccess: () => {
      push('Assets released and recorded against their holder. Record the handover once they are collected.', 'success');
      setIssueLine(null);
      refresh();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const sendForQuotes = useMutation({
    mutationFn: (lineId: string) => api<any>(`/stock/lines/${lineId}/quotations`, { method: 'POST', body: {} }),
    onSuccess: () => {
      push('The shortfall was sent for vendor quotations.', 'success');
      refresh();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const handover = useMutation({
    mutationFn: ({ assetId, method }: { assetId: string; method: 'handed_over' | 'collected' }) =>
      api(`/assets/${assetId}/handover`, { method: 'POST', body: { method } }),
    onSuccess: () => {
      push('Handover recorded on the asset.', 'success');
      refresh();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const openIssue = (line: any) => {
    setIssueLine(line);
    const next: Record<string, string> = {};
    const free = [...line.availableAssets];
    for (const item of line.items) {
      const asset = free.shift();
      if (asset) next[item.id] = asset.id;
    }
    setAssignments(next);
    setAuthorizedById('');
  };

  const summary = query.data?.summary;
  const levels = query.data?.levels ?? [];
  const awaitingHandover = useMemo(
    () => (handovers.data?.rows ?? []).filter((a: any) => a.handoverStatus === 'awaiting_handover'),
    [handovers.data],
  );
  const releaseRequired = meta.data?.settings?.stockReleaseAuthorization !== 'not_required';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Stock Management</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Check availability, release what is in stock with the required authorisation, record the handover, and send the
            shortfall for quotations.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/assets?register=1')} icon={<PackagePlus className="h-4 w-4" />}>
          Register an existing asset
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Available in stock', value: summary?.available ?? 0, icon: <PackageCheck className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-600' },
          { label: 'Awaiting handover', value: summary?.awaitingHandover ?? 0, icon: <HandCoins className="h-4 w-4" />, tone: 'bg-amber-50 text-amber-600' },
          { label: 'Awaiting stock check', value: summary?.awaitingCheck ?? 0, icon: <PackageSearch className="h-4 w-4" />, tone: 'bg-brand-50 text-brand-600' },
          { label: 'Awaiting quotations', value: summary?.awaitingQuote ?? 0, icon: <Send className="h-4 w-4" />, tone: 'bg-violet-50 text-violet-600' },
        ].map((s) => (
          <Card key={s.label} className="flex items-center gap-3 p-4">
            <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', s.tone)}>{s.icon}</span>
            <div>
              <p className="text-xl font-bold text-ink">{s.value}</p>
              <p className="text-[11px] text-slate-500">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      <Callout tone="info" title="Release and handover">
        Stock is released in priority order: Critical, High, Medium, then Low, and the earliest submission first. Each
        release names the person who authorised it and the person issuing it. Issuing is not the same as collecting — record
        the handover once the item physically reaches the holder.
      </Callout>

      {awaitingHandover.length ? (
        <Card>
          <CardHeader
            title="Handovers to record"
            subtitle="Issued assets that have not yet been handed over or collected"
            action={<Badge className="bg-amber-50 text-amber-700 ring-amber-200">{awaitingHandover.length}</Badge>}
          />
          <div className="divide-y divide-slate-50">
            {awaitingHandover.map((a: any) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/assets/${a.id}`} className="text-xs font-semibold text-brand-600 hover:underline">
                      {a.ref}
                    </Link>
                    <span className="text-[12px] font-medium text-ink">{a.assetTypeName}</span>
                    <Badge className="bg-amber-50 text-amber-700 ring-amber-200">
                      {HANDOVER_LABELS.awaiting_handover}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    For {a.holderName ?? a.roomName ?? 'the holder'} · issued {shortDate(a.registeredAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={handover.isPending}
                    onClick={() => handover.mutate({ assetId: a.id, method: 'handed_over' })}
                    icon={<HandCoins className="h-3.5 w-3.5" />}
                  >
                    Handed over
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={handover.isPending}
                    onClick={() => handover.mutate({ assetId: a.id, method: 'collected' })}
                    icon={<BadgeCheck className="h-3.5 w-3.5" />}
                  >
                    Collected
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {query.isLoading ? (
        <Spinner />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />
      ) : query.data.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PackageCheck className="h-6 w-6" />}
            title="Nothing waiting for a stock check"
            message="Requests appear here once they have cleared their reviews and approvals."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {query.data.rows.map((line: any) => {
            const requested = line.items.filter((i: any) => i.status === 'requested');
            const purchased = line.items.filter((i: any) => i.status === 'purchased');
            const canIssue = requested.length + purchased.length > 0 && line.availableAssets.length > 0;
            return (
              <Card key={line.lineId}>
                <div className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/requests/${line.requestId}`} className="text-sm font-semibold text-brand-600 hover:underline">
                          {line.ref}
                        </Link>
                        <PriorityBadge priority={line.priority} />
                        {line.isGroup ? (
                          <Badge className="bg-violet-50 text-violet-700 ring-violet-200">Group request</Badge>
                        ) : null}
                        <Badge className="bg-slate-100 text-slate-600 ring-slate-200">{relativeTime(line.raisedAt)}</Badge>
                      </div>
                      <p className="mt-1 text-[13px] font-medium text-ink">
                        {line.quantity} × {line.assetTypeName}
                        <span className="ml-1 text-[11px] font-normal text-slate-500">
                          for {line.raisedForName}
                          {line.custodyKind === 'location' ? ` · ${line.roomName}` : ' · assigned to the person'}
                        </span>
                      </p>
                      <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-slate-500">{line.justification}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge
                        className={
                          line.availableCount > 0
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                            : 'bg-red-50 text-red-700 ring-red-200'
                        }
                      >
                        {line.availableCount} available in stock
                      </Badge>
                      <span className="text-[10.5px] text-slate-400">
                        {line.requestedCount} requested · {line.purchasedCount} purchased
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {line.items.map((item: any) => (
                      <Badge
                        key={item.id}
                        className={
                          item.status === 'purchased'
                            ? 'bg-cyan-50 text-cyan-700 ring-cyan-200'
                            : 'bg-slate-100 text-slate-600 ring-slate-200'
                        }
                      >
                        #{item.seq} {item.status === 'purchased' ? 'purchased' : 'requested'}
                        {item.recipientName ? ` · ${item.recipientName}` : ''}
                      </Badge>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!canIssue}
                      onClick={() => openIssue(line)}
                      icon={<PackageCheck className="h-3.5 w-3.5" />}
                    >
                      Release from stock
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => sendForQuotes.mutate(line.lineId)}
                      loading={sendForQuotes.isPending}
                      disabled={requested.length === 0}
                      icon={<Send className="h-3.5 w-3.5" />}
                    >
                      Send the shortfall for quotations
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/requests/${line.requestId}`)}>
                      Open request
                    </Button>
                  </div>
                  {!canIssue && requested.length > 0 ? (
                    <p className="mt-2 text-[11px] text-amber-700">
                      No matching stock. Send the shortfall for quotations, or register items you have found in the store.
                    </p>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {levels.length ? (
        <Card>
          <CardHeader
            title="Stock levels by asset type"
            subtitle="Availability against outstanding demand"
            action={<Boxes className="h-4 w-4 text-slate-400" />}
          />
          <div className="table-scroll">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr>
                  {['Asset type', 'Category', 'Available', 'Assigned', 'Demand'].map((h) => (
                    <th
                      key={h}
                      className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {levels.slice(0, 20).map((l: any) => (
                  <tr key={l.assetTypeName + l.category}>
                    <td className="border-b border-slate-50 px-4 py-2.5 text-slate-700">{l.assetTypeName}</td>
                    <td className="border-b border-slate-50 px-4 py-2.5 text-slate-500">{l.category}</td>
                    <td className={cn('border-b border-slate-50 px-4 py-2.5 font-semibold', l.low ? 'text-red-600' : 'text-emerald-600')}>
                      {l.available}
                    </td>
                    <td className="border-b border-slate-50 px-4 py-2.5 text-slate-600">{l.assigned}</td>
                    <td className="border-b border-slate-50 px-4 py-2.5 text-slate-600">{l.demand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Modal
        open={!!issueLine}
        onClose={() => setIssueLine(null)}
        title={`Release stock — ${issueLine?.ref ?? ''}`}
        description={`${issueLine?.assetTypeName ?? ''} for ${issueLine?.raisedForName ?? ''}`}
        width="max-w-xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setIssueLine(null)} disabled={issue.isPending}>
              Cancel
            </Button>
            <Button
              loading={issue.isPending}
              onClick={() => {
                const payload = Object.entries(assignments)
                  .filter(([, assetId]) => !!assetId)
                  .map(([itemId, assetId]) => ({ itemId, assetId }));
                if (!payload.length) {
                  push('Choose the asset to release for at least one unit.', 'error');
                  return;
                }
                if (releaseRequired && !authorizedById) {
                  push('Name the person who authorised this release.', 'error');
                  return;
                }
                issue.mutate({ assignments: payload, authorizedById: authorizedById || null });
              }}
            >
              Confirm release
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Callout tone="info">
            Each unit is released against one specific asset, so the register always knows which serial number sits with
            whom. The handover is recorded separately once the item reaches the holder.
          </Callout>
          {issueLine?.items.map((item: any) => (
            <Field key={item.id} label={`Unit #${item.seq}${item.recipientName ? ` — for ${item.recipientName}` : ''}`}>
              <Select
                value={assignments[item.id] ?? ''}
                onChange={(e) => setAssignments({ ...assignments, [item.id]: e.target.value })}
              >
                <option value="">Leave for the shortfall</option>
                {issueLine.availableAssets.map((a: any) => (
                  <option
                    key={a.id}
                    value={a.id}
                    disabled={Object.entries(assignments).some(([k, v]) => v === a.id && k !== item.id)}
                  >
                    {a.ref} · {a.serialNumber ?? 'no serial'} · {a.condition}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          <Field
            label={releaseRequired ? 'Authorised by' : 'Authorised by (optional)'}
            required={releaseRequired}
            hint="A release must be authorised by someone other than the person issuing it."
          >
            <Select value={authorizedById} onChange={(e) => setAuthorizedById(e.target.value)}>
              <option value="">Choose the authorising person…</option>
              {(meta.data?.staff ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.jobTitle ?? 'Staff'}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-[11px] text-slate-500">
            These items go to{' '}
            {issueLine?.custodyKind === 'location'
              ? issueLine?.roomName
              : issueLine?.items.find((i: any) => i.recipientName)?.recipientName ?? issueLine?.raisedForName}
            .
          </p>
        </div>
      </Modal>

      <Card className="p-4">
        <p className="text-[11px] leading-relaxed text-slate-500">
          <Truck className="mr-1 inline h-3 w-3" />
          Returned assets come back into stock here. They are never re-issued automatically: the stock manager decides who
          receives them next, and a fresh release and handover are recorded.
        </p>
      </Card>
    </div>
  );
}
