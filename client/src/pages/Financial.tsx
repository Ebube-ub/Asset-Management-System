import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarClock, CheckCircle2, Clock, Wallet, XCircle } from 'lucide-react';
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
  Input,
  Modal,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '../components/ui';
import { DecisionBadge, PriorityBadge } from '../components/badges';
import { dateTime, naira, relativeTime, shortDate } from '../lib/format';

export function FinancialPage() {
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['financial'], queryFn: () => api<any>('/financial') });
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [target, setTarget] = useState<any | null>(null);
  const [decision, setDecision] = useState<'approve' | 'decline' | 'defer'>('approve');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const decide = useMutation({
    mutationFn: (payload: any) => api<any>(`/financial/lines/${target.lineId}/decision`, { method: 'POST', body: payload }),
    onSuccess: () => {
      push(
        decision === 'approve'
          ? 'Request approved. The stock manager can now record the purchase.'
          : decision === 'decline'
            ? 'Request declined and the affected items closed.'
            : 'Request deferred and the affected items parked.',
        'success',
      );
      setTarget(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['financial'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['request'] });
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  if (query.isLoading) return <Spinner label="Loading financial workspace…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const { rows, history, totals, settings, ownRequests } = query.data;

  const openDecision = (row: any, value: 'approve' | 'decline' | 'defer') => {
    setTarget(row);
    setDecision(value);
    setAmount(row.chosenAmount ? String(row.chosenAmount) : '');
    setNote('');
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">Financial Approvals</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every request that needs buying comes here once at least one quotation is recorded. Decide by request line —
          there is no partial approval.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Awaiting your decision', value: totals.awaitingDecision, icon: <Wallet className="h-4 w-4" />, tone: 'bg-amber-50 text-amber-600' },
          { label: 'Parked items', value: totals.parked, icon: <Clock className="h-4 w-4" />, tone: 'bg-violet-50 text-violet-600' },
          { label: 'Due for review now', value: totals.dueForReview, icon: <CalendarClock className="h-4 w-4" />, tone: 'bg-red-50 text-red-600' },
          { label: 'Approved spending', value: naira(totals.approvedSpend), icon: <CheckCircle2 className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-600' },
        ].map((s) => (
          <Card key={s.label} className="flex items-center gap-3 p-4">
            <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', s.tone)}>{s.icon}</span>
            <div>
              <p className="text-lg font-bold text-ink">{s.value}</p>
              <p className="text-[11px] text-slate-500">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setTab('pending')}
          className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors', tab === 'pending' ? 'bg-white text-ink shadow-sm' : 'text-slate-500')}
        >
          Pending decisions ({rows.length})
        </button>
        <button
          onClick={() => setTab('history')}
          className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors', tab === 'history' ? 'bg-white text-ink shadow-sm' : 'text-slate-500')}
        >
          Decision history ({history.length})
        </button>
      </div>

      {tab === 'pending' ? (
        <>
          {rows.some((r: any) => r.dueForReview) ? (
            <Callout tone="warning" title="Parked items are due for review">
              These appear first. The review period is {settings.parkedReviewDays} days and can be changed in Settings.
            </Callout>
          ) : null}

          {ownRequests > 0 ? (
            <Callout tone="info" title="Your own requests">
              {settings.secondApproverName
                ? `${ownRequests} line(s) on your own requests are decided by the second approver, ${settings.secondApproverName}.`
                : 'You cannot approve your own requests and no second approver is configured yet.'}
            </Callout>
          ) : null}

          {rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Wallet className="h-6 w-6" />}
                title="No financial decisions waiting"
                message="Lines arrive here once the stock manager has chosen a quotation."
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {rows.map((r: any) => (
                <Card key={r.lineId} className={cn('p-4', r.dueForReview && 'border-amber-300 bg-amber-50/30')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/requests/${r.requestId}`} className="text-sm font-semibold text-brand-600 hover:underline">
                          {r.ref}
                        </Link>
                        <PriorityBadge priority={r.priority} />
                        {r.dueForReview ? (
                          <Badge className="bg-red-50 text-red-700 ring-red-200" dot>
                            Due for review
                          </Badge>
                        ) : r.parkedCount ? (
                          <Badge className="bg-orange-50 text-orange-700 ring-orange-200">Parked</Badge>
                        ) : null}
                        <Badge className="bg-slate-100 text-slate-600 ring-slate-200">
                          {r.awaitingCount || r.parkedCount} item(s)
                        </Badge>
                      </div>
                      <p className="mt-1 text-[13px] font-medium text-ink">
                        {r.assetTypeName}
                        {r.roomName ? ` · ${r.roomName}` : ''}
                      </p>
                      <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-slate-500">{r.justification}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                        <span>For {r.raisedForName}</span>
                        <span>{r.quoteCount} quotation(s)</span>
                        {r.vendorName ? (
                          <span>
                            Chosen: <span className="font-medium text-ink">{r.vendorName}</span> — {naira(r.chosenAmount)}
                          </span>
                        ) : (
                          <span className="text-red-600">No quotation chosen</span>
                        )}
                        {r.reviewDueAt ? <span>Review due {shortDate(r.reviewDueAt)}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <p className="text-lg font-bold text-ink">{r.chosenAmount != null ? naira(r.chosenAmount) : '—'}</p>
                      {r.canDecide ? (
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" variant="success" onClick={() => openDecision(r, 'approve')} icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openDecision(r, 'defer')} icon={<Clock className="h-3.5 w-3.5" />}>
                            Defer
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => openDecision(r, 'decline')} icon={<XCircle className="h-3.5 w-3.5" />}>
                            Decline
                          </Button>
                        </div>
                      ) : (
                        <p className="max-w-[220px] text-right text-[10.5px] text-amber-700">
                          Your own request — the second approver decides.
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardHeader title="Financial decision history" subtitle="Who decided, when, and for how much" />
          {history.length === 0 ? (
            <EmptyState title="No decisions recorded yet" />
          ) : (
            <div className="table-scroll">
              <table className="w-full min-w-[720px] text-xs">
                <thead>
                  <tr>
                    {['Request', 'Asset type', 'Decision', 'Approved amount', 'Decided by', 'When', 'Note'].map((h) => (
                      <th key={h} className="border-b border-slate-100 bg-slate-50/60 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h: any) => (
                    <tr key={h.id}>
                      <td className="border-b border-slate-50 px-3 py-2.5">
                        <Link to={`/requests/${h.requestId}`} className="font-semibold text-brand-600 hover:underline">
                          {h.ref}
                        </Link>
                      </td>
                      <td className="border-b border-slate-50 px-3 py-2.5 text-slate-600">{h.assetTypeName}</td>
                      <td className="border-b border-slate-50 px-3 py-2.5"><DecisionBadge decision={h.decision} /></td>
                      <td className="border-b border-slate-50 px-3 py-2.5 font-medium">{h.approvedAmount != null ? naira(h.approvedAmount) : '—'}</td>
                      <td className="border-b border-slate-50 px-3 py-2.5 text-slate-600">{h.decidedByName}</td>
                      <td className="border-b border-slate-50 px-3 py-2.5 text-slate-500">{relativeTime(h.decidedAt)}</td>
                      <td className="max-w-[220px] truncate border-b border-slate-50 px-3 py-2.5 text-slate-500">{h.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={
          decision === 'approve' ? 'Approve this line' : decision === 'decline' ? 'Decline this line' : 'Defer this line'
        }
        description={target ? `${target.ref} · ${target.assetTypeName}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={decide.isPending}>
              Cancel
            </Button>
            <Button
              variant={decision === 'decline' ? 'danger' : decision === 'defer' ? 'outline' : 'success'}
              loading={decide.isPending}
              onClick={() =>
                decide.mutate({
                  decision,
                  approvedAmount: decision === 'approve' ? Number(amount) : undefined,
                  note: note.trim() || null,
                })
              }
            >
              {decision === 'approve' ? 'Approve' : decision === 'decline' ? 'Decline and close items' : 'Defer and park items'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {decision === 'approve' ? (
            <Field label="Approved amount (₦)" required hint="Taken from the chosen quotation unless amended here">
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          ) : null}
          <Field label="Note" hint="Recorded with the decision in the request history.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Callout tone={decision === 'decline' ? 'danger' : decision === 'defer' ? 'warning' : 'success'}>
            {decision === 'approve'
              ? 'Approving records who decided, when, and the approved amount, and links it to the chosen quotation.'
              : decision === 'decline'
                ? 'Declining closes the affected items automatically. The request closes only if nothing on it was issued.'
                : `Deferring parks the affected items and keeps the request open. They become due for review after ${settings.parkedReviewDays} days.`}
          </Callout>
          <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            {dateTime(new Date().toISOString())} · decision recorded against your account.
          </p>
        </div>
      </Modal>
    </div>
  );
}
