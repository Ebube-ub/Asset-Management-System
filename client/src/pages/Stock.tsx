import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, PackageCheck, PackagePlus, PackageSearch, Send, Truck } from 'lucide-react';
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
import { PriorityBadge, RequestStatusBadge } from '../components/badges';
import { relativeTime } from '../lib/format';

export function StockPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { push } = useToast();
  const query = useQuery({ queryKey: ['stock'], queryFn: () => api<any>('/stock') });
  const [issueLine, setIssueLine] = useState<any | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['stock'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['requests'] });
  };

  const issue = useMutation({
    mutationFn: (payload: any) => api<any>(`/stock/lines/${issueLine.lineId}/issue`, { method: 'POST', body: payload }),
    onSuccess: () => {
      push('Items issued and recorded against their holder.', 'success');
      setIssueLine(null);
      refresh();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const sendForQuotes = useMutation({
    mutationFn: (lineId: string) => api<any>(`/stock/lines/${lineId}/quotations`, { method: 'POST', body: {} }),
    onSuccess: () => {
      push('Shortfall sent for vendor quotations.', 'success');
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
  };

  const summary = query.data?.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Stock Management</h1>
          <p className="mt-1 text-sm text-slate-500">
            Check availability by asset type, issue what is in stock, and send the shortfall for quotations.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/assets?register=1')} icon={<PackagePlus className="h-4 w-4" />}>
          Register existing asset
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Available in stock', value: summary?.available ?? 0, icon: <PackageCheck className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-600' },
          { label: 'Awaiting stock check', value: summary?.awaitingCheck ?? 0, icon: <PackageSearch className="h-4 w-4" />, tone: 'bg-brand-50 text-brand-600' },
          { label: 'Awaiting quotations', value: summary?.awaitingQuote ?? 0, icon: <Send className="h-4 w-4" />, tone: 'bg-violet-50 text-violet-600' },
          { label: 'Awaiting issuance', value: summary?.awaitingIssue ?? 0, icon: <Truck className="h-4 w-4" />, tone: 'bg-amber-50 text-amber-600' },
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

      <Callout tone="info" title="Issuance order">
        Stock is issued by priority — Critical, then High, Medium and Low, then the earliest submission. There are no
        reservations: if an item is taken before it is issued, it goes back to the stock check.
      </Callout>

      {query.isLoading ? (
        <Spinner />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />
      ) : query.data.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PackageCheck className="h-6 w-6" />}
            title="The stock check is clear"
            message="Requests appear here once a line manager passes them to the stock check."
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
                      <Badge className={line.availableCount > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}>
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
                      Issue from stock
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => sendForQuotes.mutate(line.lineId)}
                      loading={sendForQuotes.isPending}
                      disabled={requested.length === 0}
                      icon={<Send className="h-3.5 w-3.5" />}
                    >
                      Send shortfall for quotations
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/requests/${line.requestId}`)}>
                      Open request
                    </Button>
                  </div>
                  {!canIssue && requested.length > 0 ? (
                    <p className="mt-2 text-[11px] text-amber-700">
                      No matching stock. Send the shortfall for quotations, or register items found in the store first.
                    </p>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!issueLine}
        onClose={() => setIssueLine(null)}
        title={`Issue stock — ${issueLine?.ref ?? ''}`}
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
                  push('Choose the stock item to issue for at least one unit.', 'error');
                  return;
                }
                issue.mutate({ assignments: payload });
              }}
            >
              Confirm issuance
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Callout tone="info">
            Each unit is issued against a specific asset, so the register always knows which serial number sits with whom.
          </Callout>
          {issueLine?.items.map((item: any) => (
            <Field key={item.id} label={`Unit #${item.seq}`}>
              <Select
                value={assignments[item.id] ?? ''}
                onChange={(e) => setAssignments({ ...assignments, [item.id]: e.target.value })}
              >
                <option value="">Leave for the shortfall</option>
                {issueLine.availableAssets.map((a: any) => (
                  <option key={a.id} value={a.id} disabled={Object.entries(assignments).some(([k, v]) => v === a.id && k !== item.id)}>
                    {a.ref} · {a.serialNumber ?? 'no serial'} · {a.condition}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          <p className="text-[11px] text-slate-500">
            These items are issued to {issueLine?.custodyKind === 'location' ? issueLine?.roomName : issueLine?.raisedForName}.
          </p>
        </div>
      </Modal>
    </div>
  );
}
