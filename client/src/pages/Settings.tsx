import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Save, Scale, Settings2 } from 'lucide-react';
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
  Select,
  Spinner,
  Table,
  Td,
  Th,
  useToast,
} from '../components/ui';
import { dateTime } from '../lib/format';

export function SettingsPage() {
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api<any>('/settings') });
  const [weights, setWeights] = useState({ price: 40, quality: 30, delivery: 15, warranty: 15 });
  const [days, setDays] = useState('7');
  const [approver, setApprover] = useState('');

  useEffect(() => {
    if (query.data) {
      setWeights(query.data.weights);
      setDays(String(query.data.parkedReviewDays));
      setApprover(query.data.secondApproverId ?? '');
    }
  }, [query.data]);

  const total = weights.price + weights.quality + weights.delivery + weights.warranty;

  const save = useMutation({
    mutationFn: (payload: any) => api<any>('/settings', { method: 'PUT', body: payload }),
    onSuccess: () => {
      push('Settings saved.', 'success');
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['meta'] });
      void qc.invalidateQueries({ queryKey: ['financial'] });
      void qc.invalidateQueries({ queryKey: ['quotations'] });
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;

  const setWeight = (key: keyof typeof weights, value: number) => setWeights({ ...weights, [key]: Math.max(0, Math.min(100, value)) });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure quotation scoring, the parked-item review period and the second financial approver.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader
            title="Quotation scoring weights"
            subtitle="Each recommendation keeps the weights it used"
            action={
              <Badge className={total === 100 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}>
                Total {total}%
              </Badge>
            }
          />
          <div className="space-y-4 p-5">
            {(['price', 'quality', 'delivery', 'warranty'] as const).map((key) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold capitalize text-slate-700">{key}</span>
                  <span className="font-semibold text-brand-600">{weights[key]}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={weights[key]}
                    onChange={(e) => setWeight(key, Number(e.target.value))}
                    className="h-2 flex-1 cursor-pointer accent-brand-500"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weights[key]}
                    onChange={(e) => setWeight(key, Number(e.target.value))}
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  />
                </div>
              </div>
            ))}

            {total !== 100 ? (
              <Callout tone="danger" title="The weights must total 100%">
                They currently total {total}%. Adjust them before saving — the server rejects any other total.
              </Callout>
            ) : (
              <Callout tone="info">
                Price score = cheapest ÷ this quote. Quality = rating ÷ 5. Delivery = fastest ÷ this quote (minimum one
                day). Warranty = this quote ÷ longest, and zero for everyone when no quote offers a warranty.
              </Callout>
            )}
            <Button
              loading={save.isPending}
              disabled={total !== 100}
              onClick={() => save.mutate({ weights })}
              icon={<Save className="h-4 w-4" />}
            >
              Save weights
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Parked items" subtitle="How long before a deferred item is due for review" />
            <div className="space-y-3 p-5">
              <Field label="Review period (days)" hint="Default 7 days. Due items appear first in pending approvals.">
                <Input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
              <Button
                variant="outline"
                loading={save.isPending}
                onClick={() => save.mutate({ parkedReviewDays: Number(days) })}
              >
                Save review period
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Second financial approver"
              subtitle="Decides the financial executive's own requests"
              action={<Scale className="h-4 w-4 text-slate-400" />}
            />
            <div className="space-y-3 p-5">
              <Field label="Approver" hint="The financial executive cannot approve their own request.">
                <Select value={approver} onChange={(e) => setApprover(e.target.value)}>
                  <option value="">No second approver configured</option>
                  {(query.data.staff ?? []).map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name} — {s.jobTitle ?? 'Staff'}</option>
                  ))}
                </Select>
              </Field>
              <Button variant="outline" loading={save.isPending} onClick={() => save.mutate({ secondApproverId: approver || null })}>
                Save approver
              </Button>
              <Callout tone="warning" title="Awaiting confirmation">
                The PRD lists the names and roles of the executives as an open business decision. This setting keeps the
                second approver configurable rather than hard-coded.
              </Callout>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Weights history" subtitle="Every weight set is kept with who set it and when" action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{(query.data.weightsHistory ?? []).length}</Badge>} />
        {(query.data.weightsHistory ?? []).length === 0 ? (
          <EmptyState title="No weight changes yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Effective from</Th>
                <Th>Price</Th>
                <Th>Quality</Th>
                <Th>Delivery</Th>
                <Th>Warranty</Th>
                <Th>Set by</Th>
              </tr>
            </thead>
            <tbody>
              {query.data.weightsHistory.map((w: any) => (
                <tr key={w.id}>
                  <Td className="text-xs text-slate-600">{dateTime(w.effectiveFrom)}</Td>
                  <Td className="text-xs">{w.price}%</Td>
                  <Td className="text-xs">{w.quality}%</Td>
                  <Td className="text-xs">{w.delivery}%</Td>
                  <Td className="text-xs">{w.warranty}%</Td>
                  <Td className="text-xs text-slate-600">{w.setByName ?? 'System'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="p-4">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
          <Settings2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          Release 1 scope: no purchase orders, automated funds release, goods-received checks, depreciation, barcode or QR
          scanning, maintenance management or notification delivery. Purchasing stays manual and the system records the
          outcome.
        </p>
        <p className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Assumptions awaiting sign-off are documented in the README: disposal pre-marking, whole-line financial approval,
          re-quoting parked items, and whether the disposal approver must differ from the proposer.
        </p>
      </Card>
    </div>
  );
}
