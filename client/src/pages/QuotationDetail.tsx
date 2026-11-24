import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Award, CheckCircle2, FileText, Plus, Scale, Star } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ErrorState,
  Field,
  FileField,
  Input,
  Modal,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '../components/ui';
import { PriorityBadge } from '../components/badges';
import { dateTime, naira } from '../lib/format';

export function QuotationDetailPage() {
  const { id } = useParams();
  const { hasRole } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['quotation', id], queryFn: () => api<any>(`/quotations/lines/${id}`) });

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ vendorName: '', amount: '', deliveryDays: '7', warrantyMonths: '12', qualityRating: '3' });
  const [doc, setDoc] = useState<{ url: string; name: string } | null>(null);
  const [chooseQuote, setChooseQuote] = useState<any | null>(null);
  const [reason, setReason] = useState('');

  const canManage = hasRole('stock_manager') || hasRole('administrator');

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['quotation', id] });
    void qc.invalidateQueries({ queryKey: ['quotations'] });
    void qc.invalidateQueries({ queryKey: ['request'] });
    void qc.invalidateQueries({ queryKey: ['financial'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const addQuote = useMutation({
    mutationFn: (payload: any) => api<any>(`/quotations/lines/${id}/quotes`, { method: 'POST', body: payload }),
    onSuccess: () => {
      push('Quotation recorded and scored.', 'success');
      setAddOpen(false);
      setForm({ vendorName: '', amount: '', deliveryDays: '7', warrantyMonths: '12', qualityRating: '3' });
      setDoc(null);
      reload();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const choose = useMutation({
    mutationFn: (payload: any) => api<any>(`/quotations/lines/${id}/choose`, { method: 'POST', body: payload }),
    onSuccess: () => {
      push('Quotation chosen. The line now awaits the financial decision.', 'success');
      setChooseQuote(null);
      setReason('');
      reload();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  if (query.isLoading) return <Spinner label="Loading quotation set…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const { line, quotes, scored, recommendedId, weights, choice, decision, items } = query.data;
  const recommended = scored.find((s: any) => s.recommended);
  const chosen = quotes.find((q: any) => q.id === choice?.chosenQuoteId);

  return (
    <div className="space-y-4">
      <div>
        <button onClick={() => history.back()} className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-brand-600">
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-tight text-ink">Quotation comparison</h1>
              <PriorityBadge priority={line.priority} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              <Link to={`/requests/${line.requestId}`} className="font-medium text-brand-600 hover:underline">
                {line.ref}
              </Link>{' '}
              · {line.quantity} × {line.assetTypeName} for {line.raisedForName}
              {line.custodyKind === 'location' ? ` · ${line.roomName}` : ''}
            </p>
          </div>
          {canManage ? (
            <Button onClick={() => setAddOpen(true)} icon={<Plus className="h-4 w-4" />}>
              Record quotation
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Price', value: `${weights.price}%` },
          { label: 'Quality', value: `${weights.quality}%` },
          { label: 'Delivery', value: `${weights.delivery}%` },
          { label: 'Warranty', value: `${weights.warranty}%` },
        ].map((w) => (
          <Card key={w.label} className="p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{w.label} weight</p>
            <p className="mt-0.5 text-lg font-bold text-ink">{w.value}</p>
          </Card>
        ))}
      </div>

      {quotes.length === 0 ? (
        <Card>
          <div className="px-6 py-14 text-center">
            <Scale className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <p className="text-sm font-semibold text-ink">No quotations yet</p>
            <p className="mt-1 text-xs text-slate-500">
              At least one quotation is required before this line can go to the financial decision.
            </p>
            {canManage ? (
              <Button className="mt-4" size="sm" onClick={() => setAddOpen(true)}>
                Record the first quotation
              </Button>
            ) : null}
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Side-by-side comparison"
              subtitle={`${quotes.length} quotation(s). Recommended: ${recommended?.vendorName ?? '—'}`}
              action={
                recommended ? (
                  <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">
                    <Award className="h-3 w-3" /> Highest score {recommended.totalScore.toFixed(3)}
                  </Badge>
                ) : null
              }
            />
            <div className="table-scroll">
              <table className="w-full min-w-[900px] text-xs">
                <thead>
                  <tr>
                    {['Vendor', 'Amount', 'Delivery', 'Warranty', 'Quality', 'Price score', 'Quality score', 'Delivery score', 'Warranty score', 'Total', ''].map((h) => (
                      <th key={h} className="border-b border-slate-100 bg-slate-50/60 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q: any) => {
                    const s = scored.find((x: any) => x.id === q.id);
                    const isChosen = choice?.chosenQuoteId === q.id;
                    return (
                      <tr key={q.id} className={cn('border-b border-slate-50', s?.recommended && 'bg-emerald-50/30', isChosen && 'bg-brand-50/30')}>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-ink">{q.vendorName}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {s?.recommended ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">Recommended</span> : null}
                            {isChosen ? <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand-700">Chosen</span> : null}
                          </div>
                          {q.documentUrl ? (
                            <a href={q.documentUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-brand-600 hover:underline">
                              <FileText className="h-3 w-3" /> {q.documentName ?? 'Document'}
                            </a>
                          ) : (
                            <p className="mt-1 text-[10px] text-slate-400">No document attached</p>
                          )}
                        </td>
                        <td className="px-3 py-3 font-semibold text-ink">{naira(q.amount)}</td>
                        <td className="px-3 py-3">{q.deliveryDays} days</td>
                        <td className="px-3 py-3">{q.warrantyMonths} months</td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {q.qualityRating}/5
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-600">{s?.priceScore.toFixed(3)}</td>
                        <td className="px-3 py-3 text-slate-600">{s?.qualityScore.toFixed(3)}</td>
                        <td className="px-3 py-3 text-slate-600">{s?.deliveryScore.toFixed(3)}</td>
                        <td className="px-3 py-3 text-slate-600">{s?.warrantyScore.toFixed(3)}</td>
                        <td className="px-3 py-3 text-sm font-bold text-ink">{s?.totalScore.toFixed(3)}</td>
                        <td className="px-3 py-3">
                          {canManage ? (
                            isChosen ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Selected
                              </span>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setChooseQuote(q)}>
                                Choose
                              </Button>
                            )
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
              <p className="flex items-start gap-1.5">
                <Scale className="mt-0.5 h-3 w-3 shrink-0" />
                Price score = cheapest ÷ this quote. Quality = rating ÷ 5. Delivery = fastest ÷ this quote (minimum one
                day). Warranty = this quote ÷ longest. Each is weighted and added.
              </p>
              {quotes.every((q: any) => q.warrantyMonths === 0) ? (
                <p className="text-amber-700">No quotation offers a warranty, so every warranty score is zero.</p>
              ) : null}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="The choice" subtitle="Who chose, when, and why" />
              <div className="p-5 text-xs">
                {choice ? (
                  <div className="space-y-2">
                    <p className="text-ink">
                      <span className="font-semibold">{chosen?.vendorName}</span> · {naira(chosen?.amount ?? 0)}
                    </p>
                    <p className="text-slate-500">
                      Chosen by {choice.chosenByName} · {dateTime(choice.chosenAt)}
                    </p>
                    {choice.reason ? (
                      <Callout tone="warning" title="Reason for not following the recommendation">
                        {choice.reason}
                      </Callout>
                    ) : null}
                    <p className="text-[10.5px] text-slate-400">
                      Weights used: price {choice.weightsUsed?.price}%, quality {choice.weightsUsed?.quality}%, delivery{' '}
                      {choice.weightsUsed?.delivery}%, warranty {choice.weightsUsed?.warranty}%.
                    </p>
                  </div>
                ) : (
                  <p className="text-slate-500">No quotation chosen yet. The stock manager makes the final choice.</p>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Item and decision status" />
              <div className="space-y-2 p-5 text-xs">
                <div className="flex flex-wrap gap-1.5">
                  {items.map((i: any) => (
                    <Badge key={i.id} className="bg-slate-100 text-slate-600 ring-slate-200">
                      #{items.indexOf(i) + 1} {i.status.replace('_', ' ')}
                    </Badge>
                  ))}
                </div>
                {decision ? (
                  <p className="text-slate-600">
                    Decision: <span className="font-semibold text-ink">{decision.decision}</span>
                    {decision.approvedAmount != null ? ` · ${naira(decision.approvedAmount)}` : ''} · {decision.decidedByName} ·{' '}
                    {dateTime(decision.decidedAt)}
                  </p>
                ) : (
                  <p className="text-slate-500">
                    Once a quote is chosen, the line moves to the financial executive's pending approvals.
                  </p>
                )}
              </div>
            </Card>
          </div>
        </>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Record a vendor quotation"
        description="Every quotation is scored on price, quality, delivery and warranty."
        footer={
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addQuote.isPending}>
              Cancel
            </Button>
            <Button
              loading={addQuote.isPending}
              onClick={() =>
                addQuote.mutate({
                  vendorName: form.vendorName,
                  amount: Number(form.amount),
                  deliveryDays: Number(form.deliveryDays),
                  warrantyMonths: Number(form.warrantyMonths),
                  qualityRating: Number(form.qualityRating),
                  documentUrl: doc?.url ?? null,
                  documentName: doc?.name ?? null,
                })
              }
            >
              Save quotation
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Vendor name" required>
            <Input value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} placeholder="e.g. Task Systems Ltd" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total amount (₦)" required hint="The total for this request line">
              <Input type="number" min={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Quality rating (1–5)" required>
              <Input type="number" min={1} max={5} value={form.qualityRating} onChange={(e) => setForm({ ...form, qualityRating: e.target.value })} />
            </Field>
            <Field label="Delivery (days)" required hint="Same-day counts as 1">
              <Input type="number" min={0} value={form.deliveryDays} onChange={(e) => setForm({ ...form, deliveryDays: e.target.value })} />
            </Field>
            <Field label="Warranty (months)" required>
              <Input type="number" min={0} value={form.warrantyMonths} onChange={(e) => setForm({ ...form, warrantyMonths: e.target.value })} />
            </Field>
          </div>
          <FileField value={doc} onChange={setDoc} label="Supporting quotation document" />
        </div>
      </Modal>

      <Modal
        open={!!chooseQuote}
        onClose={() => setChooseQuote(null)}
        title="Choose this quotation"
        description={chooseQuote?.vendorName}
        width="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setChooseQuote(null)} disabled={choose.isPending}>
              Cancel
            </Button>
            <Button loading={choose.isPending} onClick={() => choose.mutate({ quoteId: chooseQuote.id, reason: reason || null })}>
              Confirm choice
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <p>
              Amount <span className="font-semibold text-ink">{naira(chooseQuote?.amount ?? 0)}</span> becomes the
              approved amount for this line.
            </p>
            {chooseQuote && recommendedId && chooseQuote.id !== recommendedId ? (
              <p className="mt-1 text-amber-700">
                This is not the recommended quotation ({recommended?.vendorName}, score {recommended?.totalScore.toFixed(3)}).
                A reason is required.
              </p>
            ) : null}
          </div>
          {chooseQuote && recommendedId && chooseQuote.id !== recommendedId ? (
            <Field label="Reason for choosing another quotation" required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this quotation the better choice?" />
            </Field>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
