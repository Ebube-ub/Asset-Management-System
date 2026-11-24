import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  History,
  PackageSearch,
  Quote,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Select,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '../components/ui';
import { DecisionBadge, ItemStatusBadge, PriorityBadge, RequestStatusBadge } from '../components/badges';
import { dateTime, naira, relativeTime, shortDate } from '../lib/format';
import {
  ITEM_STATUS_LABELS,
  PRIORITY_LABELS,
  scoreQuotes,
  type ItemStatus,
} from '@shared/domain';

export function RequestDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, hasRole } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();

  const query = useQuery({ queryKey: ['request', id], queryFn: () => api<any>(`/requests/${id}`) });
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<any>('/meta') });

  const [reviewOpen, setReviewOpen] = useState<false | 'pass' | 'reject'>(false);
  const [note, setNote] = useState('');
  const [newPriority, setNewPriority] = useState('');
  const [priorityJustification, setPriorityJustification] = useState('');
  const [businessImpact, setBusinessImpact] = useState('');

  const review = useMutation({
    mutationFn: (payload: any) => api<any>(`/requests/${id}/review`, { method: 'POST', body: payload }),
    onSuccess: () => {
      push(reviewOpen === 'reject' ? 'Request rejected and closed.' : 'Request passed to the next reviewer.', 'success');
      setReviewOpen(false);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['request', id] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const scoredByLine = useMemo(() => {
    if (!query.data || !meta.data) return new Map<string, any[]>();
    const map = new Map<string, any[]>();
    for (const line of query.data.lines) {
      const quotes = query.data.quotes.filter((q: any) => q.lineId === line.id);
      map.set(
        line.id,
        scoreQuotes(
          quotes.map((q: any) => ({
            id: q.id,
            amount: Number(q.amount),
            qualityRating: q.qualityRating,
            deliveryDays: q.deliveryDays,
            warrantyMonths: q.warrantyMonths,
            recordedAt: q.recordedAt,
          })),
          meta.data.settings.weights,
        ),
      );
    }
    return map;
  }, [query.data, meta.data]);

  if (query.isLoading) return <Spinner label="Loading request…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const { request, lines, items, history, quotes, choice, purchases, access, reviewChain } = query.data;

  const itemCount = items.length;
  const issued = items.filter((i: any) => i.status === 'issued').length;
  const onOrder = items.filter((i: any) => !['issued', 'closed'].includes(i.status)).length;
  const overBudget = lines.filter((l: any) => l.overBudget);
  const canReview = access?.canReview;

  return (
    <div className="space-y-4">
      <div>
        <button onClick={() => navigate('/requests')} className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-brand-600">
          <ArrowLeft className="h-3 w-3" /> Back to requests
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-tight text-ink">{request.ref}</h1>
              <RequestStatusBadge status={request.status} />
              <PriorityBadge priority={request.priority} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Raised by {request.raisedByName} for <span className="font-medium text-ink">{request.raisedForName}</span> ·{' '}
              {dateTime(request.raisedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canReview ? (
              <>
                <Button
                  variant="danger"
                  onClick={() => {
                    setNewPriority(request.priority);
                    setReviewOpen('reject');
                  }}
                  icon={<XCircle className="h-4 w-4" />}
                >
                  Reject
                </Button>
                <Button
                  variant="success"
                  onClick={() => {
                    setNewPriority(request.priority);
                    setReviewOpen('pass');
                  }}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                >
                  Pass review
                </Button>
              </>
            ) : null}
            {hasRole('stock_manager') && items.some((i: any) => ['requested', 'purchased'].includes(i.status)) ? (
              <Button variant="outline" onClick={() => navigate('/stock')} icon={<PackageSearch className="h-4 w-4" />}>
                Stock check
              </Button>
            ) : null}
            {can('quotations') && lines.some((l: any) => l.quoteCount > 0) ? (
              <Button variant="outline" onClick={() => navigate(`/quotations/${lines.find((l: any) => l.quoteCount > 0).id}`)} icon={<Quote className="h-4 w-4" />}>
                Quotations
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {overBudget.length ? (
        <Callout tone="danger" title="Over the approved amount">
          {overBudget.map((l: any) => (
            <p key={l.id}>
              {l.assetTypeName}: recorded cost {naira(l.cost)} against an approved amount of {naira(l.approvedAmount)} —{' '}
              <strong>{naira(Number(l.cost) - Number(l.approvedAmount))} over</strong>. The approved amount has not been
              changed.
            </p>
          ))}
        </Callout>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Request summary" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Summary label="Request ID" value={request.ref} />
              <Summary label="Date submitted" value={shortDate(request.raisedAt)} />
              <Summary label="Raised by" value={`${request.raisedByName} · ${request.raisedByEmail}`} />
              <Summary
                label="Raised for"
                value={`${request.raisedForName} · ${request.raisedForEmail}`}
                hint={!request.raisedForFirstSignedIn ? 'New hire — has not signed in yet' : undefined}
              />
              <Summary label="Current reviewer" value={request.currentReviewerName ?? 'No reviewer (stock check or closed)'} />
              <Summary label="Progress" value={`${issued} of ${itemCount} issued${onOrder ? `, ${onOrder} on order` : ''}`} />
            </div>
            <div className="border-t border-slate-100 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Justification</p>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-700">{request.justification}</p>
              {request.priorityJustification ? (
                <div className="mt-3 rounded-xl bg-amber-50/70 p-3">
                  <p className="text-[11px] font-semibold text-amber-800">Why this priority</p>
                  <p className="mt-0.5 text-xs text-amber-900">{request.priorityJustification}</p>
                  <p className="mt-2 text-[11px] font-semibold text-amber-800">Business impact</p>
                  <p className="mt-0.5 text-xs text-amber-900">{request.businessImpact}</p>
                </div>
              ) : null}
            </div>
            <div className="border-t border-slate-100 px-5 py-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Reporting line above {request.raisedForName.split(' ')[0]}</p>
              {reviewChain.length === 0 ? (
                <p className="text-xs text-slate-500">No manager above this person — line-manager review is skipped.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {reviewChain.map((r: any, i: number) => (
                    <span key={r.id} className="flex items-center gap-1.5">
                      <span className={cn('rounded-full px-2 py-0.5 font-medium', request.currentReviewerId === r.id ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600')}>
                        {r.name}
                      </span>
                      {i < reviewChain.length - 1 ? <ArrowRight className="h-3 w-3 text-slate-300" /> : <ArrowRight className="h-3 w-3 text-slate-300" />}
                    </span>
                  ))}
                  <ArrowRight className="h-3 w-3 text-slate-300" />
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-600">Stock check</span>
                </div>
              )}
            </div>
          </Card>

          {lines.map((line: any) => {
            const lineItems = items.filter((i: any) => i.lineId === line.id);
            const lineQuotes = quotes.filter((q: any) => q.lineId === line.id);
            const scores = scoredByLine.get(line.id) ?? [];
            const chosenScore = scores.find((s) => s.id === choice?.chosenQuoteId);
            return (
              <Card key={line.id}>
                <CardHeader
                  title={line.assetTypeName}
                  subtitle={`${line.quantity} × ${line.custodyKind === 'person' ? 'held by a person' : `held by location · ${line.roomName}`}`}
                  action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{line.availableCount} available in stock</Badge>}
                />
                <div className="space-y-4 p-5">
                  <div className="flex flex-wrap gap-1.5">
                    {lineItems.map((item: any, i: number) => (
                      <span key={item.id} className="inline-flex items-center gap-1">
                        <span className="text-[10px] text-slate-400">#{item.seq}</span>
                        <ItemStatusBadge status={item.status} reason={item.closedReason} />
                        {item.assetRef ? (
                          <Link to={`/assets/${item.issuedAssetId}`} className="text-[10px] text-brand-600 hover:underline">
                            {item.assetRef}
                          </Link>
                        ) : null}
                      </span>
                    ))}
                  </div>

                  {line.overBudget ? (
                    <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[11px] text-red-700">
                      <ShieldAlert className="h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-semibold">Actual cost exceeds the approved amount</p>
                        <p>
                          Cost {naira(line.cost)} vs approved {naira(line.approvedAmount)}. The approved amount is never
                          changed silently — review and escalate if needed.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Quotations</p>
                      <p className="mt-0.5 text-sm font-semibold text-ink">{line.quoteCount}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Approved amount</p>
                      <p className="mt-0.5 text-sm font-semibold text-ink">{line.approvedAmount != null ? naira(line.approvedAmount) : '—'}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Recorded cost</p>
                      <p className={cn('mt-0.5 text-sm font-semibold', line.overBudget ? 'text-red-600' : 'text-ink')}>
                        {line.cost != null ? naira(line.cost) : '—'}
                      </p>
                    </div>
                  </div>

                  {line.decision ? (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <DecisionBadge decision={line.decision} />
                      <span>
                        by {line.decidedByName} · {dateTime(line.decidedAt)}
                      </span>
                    </div>
                  ) : null}

                  {lineQuotes.length ? (
                    <div className="rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                        <p className="text-[11px] font-semibold text-slate-600">Quotation comparison</p>
                        <Link to={`/quotations/${line.id}`} className="text-[11px] font-semibold text-brand-600 hover:underline">
                          Open full comparison
                        </Link>
                      </div>
                      <div className="table-scroll">
                        <table className="w-full min-w-[480px] text-[11px]">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                              <th className="px-3 py-2">Vendor</th>
                              <th className="px-3 py-2">Amount</th>
                              <th className="px-3 py-2">Delivery</th>
                              <th className="px-3 py-2">Warranty</th>
                              <th className="px-3 py-2">Score</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lineQuotes.map((q: any) => {
                              const s = scores.find((x) => x.id === q.id);
                              return (
                                <tr key={q.id} className="border-t border-slate-50">
                                  <td className="px-3 py-2 font-medium text-ink">
                                    {q.vendorName}
                                    {s?.recommended ? <span className="ml-1.5 rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-semibold text-emerald-700">Recommended</span> : null}
                                    {choice?.chosenQuoteId === q.id ? <span className="ml-1.5 rounded bg-brand-50 px-1 py-0.5 text-[9px] font-semibold text-brand-600">Chosen</span> : null}
                                  </td>
                                  <td className="px-3 py-2">{naira(q.amount)}</td>
                                  <td className="px-3 py-2">{q.deliveryDays} days</td>
                                  <td className="px-3 py-2">{q.warrantyMonths} months</td>
                                  <td className="px-3 py-2 font-semibold">{(s?.totalScore ?? 0).toFixed(3)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {choice ? (
                        <p className="border-t border-slate-100 px-3 py-2 text-[10.5px] text-slate-500">
                          Chosen by {choice.chosenByName} · {dateTime(choice.chosenAt)}
                          {choice.reason ? ` — ${choice.reason}` : ''}
                          {chosenScore ? ` · score ${chosenScore.totalScore.toFixed(3)}` : ''}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {purchases.filter((p: any) => p.lineId === line.id).map((p: any) => (
                    <div key={p.id} className="rounded-xl border border-slate-200 p-3 text-[11px] text-slate-600">
                      <p className="font-semibold text-ink">Purchase recorded — {p.vendorName}</p>
                      <p className="mt-0.5">
                        {naira(p.cost)} · recorded by {p.recordedByName} · {shortDate(p.recordedAt)}
                        {p.receiptUrl ? (
                          <>
                            {' · '}
                            <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                              Receipt
                            </a>
                          </>
                        ) : (
                          ' · no receipt attached'
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Request history" subtitle="Every recorded event, newest first" />
            <div className="max-h-[520px] overflow-y-auto px-5 py-4">
              {history.length === 0 ? (
                <EmptyState icon={<History className="h-5 w-5" />} title="No history yet" />
              ) : (
                <ol className="relative space-y-4 border-l border-slate-200 pl-4">
                  {history.map((h: any) => (
                    <li key={h.id} className="relative">
                      <span className="absolute -left-[22px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 border-white bg-brand-400" />
                      <p className="text-[11.5px] font-semibold text-ink">{eventLabel(h.event)}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{h.note}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {h.byName ?? 'System'} · {relativeTime(h.at)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Next step" />
            <div className="space-y-2 p-4 text-[11.5px] leading-relaxed text-slate-600">
              {nextStep(request, items, lines).map((s, i) => (
                <p key={i} className="flex gap-2">
                  <Circle className="mt-1 h-2 w-2 shrink-0 fill-brand-300 text-brand-300" />
                  {s}
                </p>
              ))}
              {canReview ? (
                <p className="rounded-lg bg-amber-50 p-2.5 text-amber-800">
                  This request is waiting for your review. Passing it will move it on; rejecting closes it.
                </p>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={!!reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={reviewOpen === 'reject' ? 'Reject this request?' : 'Pass this request on'}
        description={
          reviewOpen === 'reject'
            ? 'Rejecting closes the request. There is no return-for-editing — the requester can raise a new request if the need remains.'
            : 'The request moves to the next reviewer, or to the stock check when a line manager passes it.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={review.isPending}>
              Cancel
            </Button>
            <Button
              variant={reviewOpen === 'reject' ? 'danger' : 'success'}
              loading={review.isPending}
              onClick={() => {
                const needsDetail = newPriority === 'high' || newPriority === 'critical';
                review.mutate({
                  action: reviewOpen === 'reject' ? 'reject' : 'pass',
                  note: note.trim() || null,
                  priority: newPriority,
                  priorityJustification: needsDetail ? priorityJustification : null,
                  businessImpact: needsDetail ? businessImpact : null,
                });
              }}
            >
              {reviewOpen === 'reject' ? 'Reject request' : 'Pass request'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Priority">
            <Select value={newPriority} onChange={(e) => setNewPriority(e.target.value)}>
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {(newPriority === 'high' || newPriority === 'critical') && newPriority !== request.priority ? (
            <>
              <Callout tone="warning" title="Justify the higher priority">
                Raising a request to High or Critical needs a priority justification and the business impact.
              </Callout>
              <Field label="Priority justification" required>
                <Textarea value={priorityJustification} onChange={(e) => setPriorityJustification(e.target.value)} className="min-h-[70px]" />
              </Field>
              <Field label="Business impact" required>
                <Textarea value={businessImpact} onChange={(e) => setBusinessImpact(e.target.value)} className="min-h-[70px]" />
              </Field>
            </>
          ) : null}
          <Field label="Note" hint="Recorded in the request history.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={reviewOpen === 'reject' ? 'Why is this being rejected?' : 'Anything the next person should know…'} />
          </Field>
          {reviewOpen === 'reject' ? (
            <Callout tone="danger" title="This cannot be undone">
              The request closes and every open item is closed as declined.
            </Callout>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

function Summary({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-[10.5px] text-amber-600">{hint}</p> : null}
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  RequestRaised: 'Request raised',
  RequestPassedReview: 'Passed review',
  RequestRejected: 'Request rejected',
  RequestCompleted: 'Request completed',
  RequestCancelled: 'Request cancelled',
  ReviewRestarted: 'Review restarted',
  StockChecked: 'Stock checked',
  ItemIssued: 'Item issued',
  ItemClosed: 'Item closed',
  QuoteRecorded: 'Quotation recorded',
  QuoteChosen: 'Quotation chosen',
  FinancialDecisionRecorded: 'Financial decision',
  PurchaseRecorded: 'Purchase recorded',
};

function eventLabel(event: string) {
  return EVENT_LABELS[event] ?? event.replace(/([A-Z])/g, ' $1').trim();
}

function nextStep(request: any, items: any[], lines: any[]): string[] {
  if (request.status === 'rejected') return ['This request was rejected and is closed.'];
  if (request.status === 'cancelled') return ['This request was cancelled because the staff member left.'];
  if (request.status === 'under_review')
    return [`Waiting for ${request.currentReviewerName ?? 'the next reviewer'} to pass or reject the request.`];
  if (request.status === 'fulfilled') return ['Every item on this request has been issued.'];
  if (request.status === 'partly_fulfilled') return ['Some items were issued and the rest are closed — this is final.'];
  if (request.status === 'closed') return ['Nothing on this request was issued; every item is closed.'];

  const out: string[] = [];
  const requested = items.filter((i) => i.status === 'requested').length;
  const quotation = items.filter((i) => i.status === 'awaiting_quotation').length;
  const decision = items.filter((i) => i.status === 'awaiting_decision').length;
  const parked = items.filter((i) => i.status === 'parked').length;
  const approved = items.filter((i) => i.status === 'approved').length;
  const purchased = items.filter((i) => i.status === 'purchased').length;
  if (requested) out.push(`${requested} item(s) wait for the stock check.`);
  if (quotation) out.push(`${quotation} item(s) need vendor quotations before a financial decision.`);
  if (decision) out.push(`${decision} item(s) wait for the financial executive.`);
  if (parked) out.push(`${parked} item(s) are parked and due for review.`);
  if (approved) out.push(`${approved} item(s) are approved — the stock manager records the purchase next.`);
  if (purchased) out.push(`${purchased} item(s) are purchased and ready to issue.`);
  if (!out.length) out.push('All items have reached their end state.');
  return out;
}
