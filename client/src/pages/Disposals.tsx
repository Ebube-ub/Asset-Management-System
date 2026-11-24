import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, PackageMinus, ShieldOff, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  Select,
  Spinner,
  Textarea,
  useToast,
} from '../components/ui';
import { naira, shortDate } from '../lib/format';
import { DISPOSAL_METHOD_LABELS } from '@shared/domain';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  approved: 'bg-brand-50 text-brand-600 ring-brand-200',
  rejected: 'bg-red-50 text-red-700 ring-red-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

export function DisposalsPage() {
  const { hasRole } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['disposals'], queryFn: () => api<any>('/disposals') });
  const assets = useQuery({ queryKey: ['assets', 'available-for-disposal'], queryFn: () => api<any>('/assets?status=available&pageSize=100') });

  const [proposeOpen, setProposeOpen] = useState(false);
  const [form, setForm] = useState({ assetId: '', method: 'sale', reason: '' });
  const [decisionTarget, setDecisionTarget] = useState<{ row: any; action: 'approve' | 'reject' } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [completeTarget, setCompleteTarget] = useState<any | null>(null);
  const [completion, setCompletion] = useState({ buyer: '', proceeds: '', note: '' });

  const isAdmin = hasRole('administrator');
  const isStock = hasRole('stock_manager');

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['disposals'] });
    void qc.invalidateQueries({ queryKey: ['assets'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const propose = useMutation({
    mutationFn: (payload: any) => api<any>('/disposals', { method: 'POST', body: payload }),
    onSuccess: () => {
      push('Disposal proposed. The stock manager must approve it.', 'success');
      setProposeOpen(false);
      setForm({ assetId: '', method: 'sale', reason: '' });
      reload();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const decide = useMutation({
    mutationFn: ({ id, action, note }: any) => api<any>(`/disposals/${id}/decide`, { method: 'POST', body: { action, note } }),
    onSuccess: (_r, vars: any) => {
      push(vars.action === 'approve' ? 'Disposal approved.' : 'Disposal rejected — the asset is available again.', 'success');
      setDecisionTarget(null);
      setDecisionNote('');
      reload();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const complete = useMutation({
    mutationFn: ({ id, body }: any) => api<any>(`/disposals/${id}/complete`, { method: 'POST', body }),
    onSuccess: () => {
      push('Disposal completed and the asset marked disposed.', 'success');
      setCompleteTarget(null);
      setCompletion({ buyer: '', proceeds: '', note: '' });
      reload();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const { rows, totals } = query.data;
  const needsMoney = completeTarget?.method === 'sale' || completeTarget?.method === 'auction';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Disposal</h1>
          <p className="mt-1 text-sm text-slate-500">
            The administrator proposes a disposal with its method; the stock manager approves it before it goes ahead.
          </p>
        </div>
        {isAdmin ? (
          <Button onClick={() => setProposeOpen(true)} icon={<PackageMinus className="h-4 w-4" />}>
            Propose disposal
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Awaiting approval', value: totals.pending },
          { label: 'Approved, not completed', value: totals.approved },
          { label: 'Completed', value: totals.completed },
          { label: 'Proceeds received', value: naira(totals.proceeds) },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs font-medium text-slate-500">{s.label}</p>
            <p className="mt-1 text-xl font-bold text-ink">{s.value}</p>
          </Card>
        ))}
      </div>

      <Callout tone="warning" title="Approval is mandatory">
        Only an available asset can be proposed. An assigned asset must be returned to stock first, and a rejected disposal
        returns the asset to Available. Completed sales and auctions record the buyer and the amount received.
      </Callout>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<ShieldOff className="h-6 w-6" />} title="No disposal proposals" message="Proposals appear here once the administrator raises one." />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((d: any) => (
            <Card key={d.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/assets/${d.assetId}`} className="text-sm font-semibold text-brand-600 hover:underline">{d.ref}</Link>
                    <Badge className={STATUS_STYLES[d.status]}>{d.status}</Badge>
                    <Badge className="bg-slate-100 text-slate-600 ring-slate-200">{DISPOSAL_METHOD_LABELS[d.method as keyof typeof DISPOSAL_METHOD_LABELS]}</Badge>
                  </div>
                  <p className="mt-1 text-[13px] font-medium text-ink">{d.assetTypeName}</p>
                  <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-slate-500">{d.reason}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Proposed by {d.proposedByName} · {shortDate(d.proposedAt)}
                    {d.decidedByName ? ` · ${d.status} by ${d.decidedByName} on ${shortDate(d.decidedAt)}` : ''}
                  </p>
                  {d.decisionNote ? <p className="mt-1 text-[11px] text-slate-500">Note: {d.decisionNote}</p> : null}
                  {d.buyer ? (
                    <p className="mt-1 text-[11px] text-slate-600">
                      Buyer: <span className="font-medium">{d.buyer}</span> · received {naira(d.proceeds ?? 0)} · completed{' '}
                      {shortDate(d.completedAt)}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {d.status === 'pending' && isStock ? (
                    <>
                      <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} onClick={() => setDecisionTarget({ row: d, action: 'approve' })}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" icon={<X className="h-3.5 w-3.5" />} onClick={() => setDecisionTarget({ row: d, action: 'reject' })}>
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {d.status === 'approved' ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setCompleteTarget(d);
                        setCompletion({ buyer: '', proceeds: '', note: '' });
                      }}
                    >
                      Complete disposal
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={proposeOpen}
        onClose={() => setProposeOpen(false)}
        title="Propose a disposal"
        footer={
          <>
            <Button variant="outline" onClick={() => setProposeOpen(false)} disabled={propose.isPending}>Cancel</Button>
            <Button loading={propose.isPending} onClick={() => propose.mutate(form)}>Propose for approval</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Available asset" required>
            <Select value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })}>
              <option value="">Select an available asset…</option>
              {(assets.data?.rows ?? []).map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.ref} · {a.assetTypeName} {a.serialNumber ? `· ${a.serialNumber}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Method" required>
            <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {Object.entries(DISPOSAL_METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" required>
            <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Why is this asset being disposed of?" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!decisionTarget}
        onClose={() => setDecisionTarget(null)}
        title={decisionTarget?.action === 'approve' ? 'Approve this disposal?' : 'Reject this disposal?'}
        description={decisionTarget ? `${decisionTarget.row.ref} · ${decisionTarget.row.assetTypeName}` : undefined}
        width="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setDecisionTarget(null)} disabled={decide.isPending}>Cancel</Button>
            <Button
              variant={decisionTarget?.action === 'approve' ? 'success' : 'danger'}
              loading={decide.isPending}
              onClick={() =>
                decisionTarget &&
                decide.mutate({ id: decisionTarget.row.id, action: decisionTarget.action, note: decisionNote || null })
              }
            >
              {decisionTarget?.action === 'approve' ? 'Approve disposal' : 'Reject disposal'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Note" hint="Kept in the asset history.">
            <Textarea value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
          </Field>
          <Callout tone={decisionTarget?.action === 'approve' ? 'warning' : 'info'}>
            {decisionTarget?.action === 'approve'
              ? 'Approving does not dispose of the asset yet — you complete the disposal afterwards, recording the buyer and amount for a sale or auction.'
              : 'Rejecting returns the asset to Available.'}
          </Callout>
        </div>
      </Modal>

      <Modal
        open={!!completeTarget}
        onClose={() => setCompleteTarget(null)}
        title="Complete the disposal"
        description={completeTarget ? `${completeTarget.ref} · ${DISPOSAL_METHOD_LABELS[completeTarget.method as keyof typeof DISPOSAL_METHOD_LABELS]}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setCompleteTarget(null)} disabled={complete.isPending}>Cancel</Button>
            <Button
              loading={complete.isPending}
              onClick={() =>
                complete.mutate({
                  id: completeTarget.id,
                  body: {
                    buyer: completion.buyer || null,
                    proceeds: completion.proceeds ? Number(completion.proceeds) : undefined,
                    note: completion.note || null,
                  },
                })
              }
            >
              Mark as disposed
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {needsMoney ? (
            <>
              <Field label="Buyer" required>
                <Input value={completion.buyer} onChange={(e) => setCompletion({ ...completion, buyer: e.target.value })} />
              </Field>
              <Field label="Amount received (₦)" required>
                <Input type="number" min={0} value={completion.proceeds} onChange={(e) => setCompletion({ ...completion, proceeds: e.target.value })} />
              </Field>
            </>
          ) : (
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              No buyer or amount is needed for {completeTarget?.method}. The asset will be marked disposed.
            </p>
          )}
          <Field label="Note">
            <Input value={completion.note} onChange={(e) => setCompletion({ ...completion, note: e.target.value })} />
          </Field>
          <Callout tone="danger" title="This is final">
            Once disposed, the asset can never be assigned again. Its history is preserved.
          </Callout>
        </div>
      </Modal>
    </div>
  );
}
