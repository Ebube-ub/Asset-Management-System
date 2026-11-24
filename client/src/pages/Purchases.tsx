import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Receipt, ShoppingCart } from 'lucide-react';
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
  FileField,
  Input,
  Modal,
  Spinner,
  useToast,
} from '../components/ui';
import { PriorityBadge } from '../components/badges';
import { dateTime, naira } from '../lib/format';

export function PurchasesPage() {
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['purchases'], queryFn: () => api<any>('/purchases') });
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<any>('/meta') });

  const [target, setTarget] = useState<any | null>(null);
  const [vendor, setVendor] = useState('');
  const [cost, setCost] = useState('');
  const [doc, setDoc] = useState<{ url: string; name: string } | null>(null);
  const [note, setNote] = useState('');

  const record = useMutation({
    mutationFn: (payload: any) => api<any>('/purchases', { method: 'POST', body: payload }),
    onSuccess: (res) => {
      push(
        res.overBudget
          ? `Purchase recorded. Warning: ${naira(res.cost - res.approvedAmount)} over the approved amount.`
          : 'Purchase recorded and the items entered the register.',
        res.overBudget ? 'error' : 'success',
      );
      setTarget(null);
      setDoc(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['purchases'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const awaiting = query.data.awaiting.rows;
  const rows = query.data.rows;
  const overBudgetCost = rows
    .filter((r: any) => r.overBudget)
    .reduce((sum: number, r: any) => sum + (r.difference ?? 0), 0);
  const previewOver = target && cost && Number(cost) > Number(target.approvedAmount ?? 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">Purchases</h1>
        <p className="mt-1 text-sm text-slate-500">
          Buying stays manual and outside the system. The stock manager records the outcome: vendor, actual cost and receipt.
        </p>
      </div>

      {overBudgetCost > 0 ? (
        <Callout tone="danger" title="Over-budget purchases recorded">
          Recorded costs exceed approved amounts by {naira(overBudgetCost)}. Approved amounts are never changed silently —
          review these purchases and escalate if needed.
        </Callout>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Approved, awaiting purchase</p>
          <p className="mt-1 text-2xl font-bold text-ink">{awaiting.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Purchases recorded</p>
          <p className="mt-1 text-2xl font-bold text-ink">{rows.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Over-budget purchases</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{rows.filter((r: any) => r.overBudget).length}</p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Awaiting purchase recording"
          subtitle="Approved items with a manual purchase outstanding"
          action={<Badge className="bg-brand-50 text-brand-600 ring-brand-200">{awaiting.length} line(s)</Badge>}
        />
        {awaiting.length === 0 ? (
          <EmptyState icon={<ShoppingCart className="h-6 w-6" />} title="Nothing to record" message="Approved lines appear here once the financial executive approves them." />
        ) : (
          <div className="divide-y divide-slate-50">
            {awaiting.map((a: any) => (
              <div key={a.lineId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/requests/${a.requestId}`} className="text-xs font-semibold text-brand-600 hover:underline">
                      {a.ref}
                    </Link>
                    <PriorityBadge priority={a.priority} />
                  </div>
                  <p className="mt-0.5 text-[13px] font-medium text-ink">{a.assetTypeName}</p>
                  <p className="text-[11px] text-slate-500">
                    {a.approvedCount} item(s) · for {a.raisedForName} · approved {naira(a.approvedAmount)}
                    {a.vendorName ? ` · quote from ${a.vendorName}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setTarget(a);
                    setVendor(a.vendorName ?? '');
                    setCost(String(a.approvedAmount ?? ''));
                    setDoc(null);
                    setNote('');
                  }}
                  icon={<Receipt className="h-3.5 w-3.5" />}
                >
                  Record purchase
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Recorded purchases" subtitle="Actual costs against the approved amount" />
        {rows.length === 0 ? (
          <EmptyState title="No purchases recorded yet" />
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[880px] text-xs">
              <thead>
                <tr>
                  {['Request', 'Asset type', 'Vendor', 'Actual cost', 'Approved', 'Difference', 'Assets', 'Receipt', 'Recorded'].map((h) => (
                    <th key={h} className="border-b border-slate-100 bg-slate-50/60 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="border-b border-slate-50 px-3 py-2.5">
                      <Link to={`/requests/${r.requestId}`} className="font-semibold text-brand-600 hover:underline">
                        {r.ref}
                      </Link>
                    </td>
                    <td className="border-b border-slate-50 px-3 py-2.5 text-slate-600">{r.assetTypeName}</td>
                    <td className="border-b border-slate-50 px-3 py-2.5 text-slate-600">{r.vendorName}</td>
                    <td className="border-b border-slate-50 px-3 py-2.5 font-medium text-ink">{naira(r.cost)}</td>
                    <td className="border-b border-slate-50 px-3 py-2.5 text-slate-600">{r.approvedAmount != null ? naira(r.approvedAmount) : '—'}</td>
                    <td className="border-b border-slate-50 px-3 py-2.5">
                      {r.overBudget ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">
                          <AlertTriangle className="h-3 w-3" /> +{naira(r.difference)}
                        </span>
                      ) : (
                        <span className="text-emerald-600">Within budget</span>
                      )}
                    </td>
                    <td className="border-b border-slate-50 px-3 py-2.5 text-slate-600">{r.assetCount}</td>
                    <td className="border-b border-slate-50 px-3 py-2.5">
                      {r.receiptUrl ? (
                        <a href={r.receiptUrl} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                          {r.receiptName ?? 'Receipt'}
                        </a>
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </td>
                    <td className="border-b border-slate-50 px-3 py-2.5 text-slate-500">
                      {dateTime(r.recordedAt)}
                      <span className="block text-[10px] text-slate-400">{r.recordedByName}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title="Record a purchase"
        description={target ? `${target.ref} · ${target.assetTypeName}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={record.isPending}>
              Cancel
            </Button>
            <Button
              loading={record.isPending}
              onClick={() =>
                record.mutate({
                  lineId: target.lineId,
                  vendorName: vendor,
                  cost: Number(cost),
                  receiptUrl: doc?.url ?? null,
                  receiptName: doc?.name ?? null,
                  note: note.trim() || null,
                })
              }
            >
              Save purchase
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600">
            Approved amount: <span className="font-semibold text-ink">{naira(target?.approvedAmount ?? 0)}</span> ·{' '}
            {target?.approvedCount} item(s)
          </div>
          <Field label="Vendor" required>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} list="vendor-options" placeholder="Who supplied the items?" />
            <datalist id="vendor-options">
              {(meta.data?.vendors ?? []).map((v: string) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Field>
          <Field label="Actual cost (₦)" required>
            <Input type="number" min={1} value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
          {previewOver ? (
            <Callout tone="danger" title="This exceeds the approved amount">
              {naira(Number(cost) - Number(target.approvedAmount))} over the approved amount. The purchase will still be
              recorded and flagged; the approved amount will not change.
            </Callout>
          ) : null}
          <FileField value={doc} onChange={setDoc} label="Receipt document" />
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the audit trail" />
          </Field>
          <p className="text-[11px] text-slate-400">
            Saving registers one asset per purchased item so the stock manager can issue them individually.
          </p>
        </div>
      </Modal>
    </div>
  );
}
