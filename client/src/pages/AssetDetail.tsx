import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowLeftRight, Building2, History, PackageCheck, ShieldOff, User, Undo2 } from 'lucide-react';
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
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '../components/ui';
import { AssetStatusBadge } from '../components/badges';
import { dateTime, humanise, naira, shortDate } from '../lib/format';
import { DISPOSAL_METHOD_LABELS } from '@shared/domain';

export function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, hasRole } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['asset', id], queryFn: () => api<any>(`/assets/${id}`) });
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<any>('/meta') });

  const [assignOpen, setAssignOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [disposalOpen, setDisposalOpen] = useState(false);
  const [destination, setDestination] = useState({ holderStaffId: '', roomId: '', note: '' });
  const [disposal, setDisposal] = useState({ method: 'sale', reason: '' });

  const isStock = hasRole('stock_manager') || hasRole('administrator');
  const isAdmin = hasRole('administrator');

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['asset', id] });
    void qc.invalidateQueries({ queryKey: ['assets'] });
    void qc.invalidateQueries({ queryKey: ['movements'] });
    void qc.invalidateQueries({ queryKey: ['disposals'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<any>(path, { method: 'POST', body: body ?? {} }),
    onSuccess: (_res, vars) => {
      push(
        vars.path.endsWith('/assign')
          ? 'Asset assigned.'
          : vars.path.endsWith('/transfer')
            ? 'Transfer requested. The stock manager must confirm it.'
            : vars.path.endsWith('/return')
              ? 'Return requested. The stock manager must confirm it.'
              : 'Disposal proposed and sent to the stock manager.',
        'success',
      );
      setAssignOpen(false);
      setTransferOpen(false);
      setReturnOpen(false);
      setDisposalOpen(false);
      setDestination({ holderStaffId: '', roomId: '', note: '' });
      setDisposal({ method: 'sale', reason: '' });
      reload();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const { asset, history, movements, disposal: activeDisposal } = query.data;
  const isPerson = asset.custodyKind === 'person';

  const destinationPayload = {
    holderStaffId: isPerson ? destination.holderStaffId || null : null,
    roomId: !isPerson ? destination.roomId || null : null,
    note: destination.note || null,
  };

  return (
    <div className="space-y-4">
      <div>
        <button onClick={() => navigate('/assets')} className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-brand-600">
          <ArrowLeft className="h-3 w-3" /> Back to assets
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-tight text-ink">{asset.ref}</h1>
              <AssetStatusBadge status={asset.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {asset.assetTypeName} · {asset.category} · {isPerson ? 'assigned to a person' : 'assigned to a location'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isStock && asset.status === 'available' ? (
              <Button onClick={() => setAssignOpen(true)} icon={<PackageCheck className="h-4 w-4" />}>Assign</Button>
            ) : null}
            {asset.status === 'assigned' ? (
              <>
                <Button variant="outline" onClick={() => setTransferOpen(true)} icon={<ArrowLeftRight className="h-4 w-4" />}>Transfer</Button>
                <Button variant="outline" onClick={() => setReturnOpen(true)} icon={<Undo2 className="h-4 w-4" />}>Return to stock</Button>
              </>
            ) : null}
            {isAdmin && asset.status === 'available' ? (
              <Button variant="danger" onClick={() => setDisposalOpen(true)} icon={<ShieldOff className="h-4 w-4" />}>Propose disposal</Button>
            ) : null}
          </div>
        </div>
      </div>

      {asset.status === 'disposed' ? (
        <Callout tone="warning" title="This asset has been disposed of">
          A disposed asset cannot be assigned or transferred. Its history is kept in full.
        </Callout>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Asset details" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Detail label="Asset ID" value={asset.ref} />
              <Detail label="Asset type" value={asset.assetTypeName} />
              <Detail label="Serial number" value={asset.serialNumber ?? '—'} mono />
              <Detail label="Condition" value={humanise(asset.condition)} />
              <Detail label="Status" value={<AssetStatusBadge status={asset.status} />} />
              <Detail label="Custody" value={isPerson ? 'Person-based' : 'Location-based'} />
              <Detail
                label={isPerson ? 'Current holder' : 'Current location'}
                value={
                  isPerson ? (
                    asset.holderName ? (
                      <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-slate-400" />{asset.holderName}</span>
                    ) : (
                      'In stock'
                    )
                  ) : asset.roomName ? (
                    <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-slate-400" />{asset.roomName}</span>
                  ) : (
                    'In stock'
                  )
                }
              />
              <Detail label="Registered" value={`${shortDate(asset.registeredAt)} · ${asset.registeredByName ?? '—'}`} />
              <Detail
                label="Purchase reference"
                value={
                  asset.requestRef ? (
                    <Link to={`/requests/${asset.requestId}`} className="text-brand-600 hover:underline">
                      {asset.requestRef}
                    </Link>
                  ) : (
                    'Registered directly — no request'
                  )
                }
              />
              <Detail
                label="Purchase cost"
                value={
                  asset.purchaseCost != null
                    ? `${naira(asset.purchaseCost)} · ${asset.purchaseVendor}`
                    : '—'
                }
              />
            </div>
            {asset.notes ? (
              <div className="border-t border-slate-100 px-5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Notes</p>
                <p className="mt-0.5 text-xs text-slate-600">{asset.notes}</p>
              </div>
            ) : null}
            {asset.receiptUrl ? (
              <div className="border-t border-slate-100 px-5 py-3 text-xs">
                <a href={asset.receiptUrl} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                  View purchase receipt
                </a>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Movements" subtitle="Transfers and returns for this asset" />
            {movements.length === 0 ? (
              <EmptyState title="No movements yet" message="Transfers and returns appear here once requested." />
            ) : (
              <div className="divide-y divide-slate-50">
                {movements.map((m: any) => (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs">
                    <div>
                      <p className="font-medium text-ink">
                        {humanise(m.kind)} → {m.toStaffName ?? m.toRoomName ?? 'Stock'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Requested by {m.requestedByName} · {dateTime(m.requestedAt)}
                        {m.confirmedByName ? ` · confirmed by ${m.confirmedByName}` : ''}
                      </p>
                      {m.note ? <p className="text-[11px] text-slate-400">{m.note}</p> : null}
                    </div>
                    <Badge
                      className={
                        m.status === 'confirmed'
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          : m.status === 'rejected'
                            ? 'bg-red-50 text-red-700 ring-red-200'
                            : 'bg-amber-50 text-amber-700 ring-amber-200'
                      }
                    >
                      {humanise(m.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {activeDisposal ? (
            <Card>
              <CardHeader title="Disposal" subtitle={humanise(activeDisposal.status)} />
              <div className="space-y-2 p-5 text-xs text-slate-600">
                <p><span className="font-semibold text-ink">{humanise(activeDisposal.method)}</span> · proposed by {activeDisposal.proposedByName}</p>
                <p>{activeDisposal.reason}</p>
                <p className="text-[11px] text-slate-500">Proposed {shortDate(activeDisposal.proposedAt)}</p>
                {activeDisposal.decidedByName ? (
                  <p className="text-[11px] text-slate-500">
                    {humanise(activeDisposal.status)} by {activeDisposal.decidedByName} · {shortDate(activeDisposal.decidedAt)}
                  </p>
                ) : null}
                {activeDisposal.buyer ? (
                  <p className="text-[11px] text-slate-500">Buyer: {activeDisposal.buyer} · {naira(activeDisposal.proceeds ?? 0)}</p>
                ) : null}
                {can('disposals') ? (
                  <Link to="/disposals" className="inline-block text-[11px] font-semibold text-brand-600 hover:underline">
                    Open disposal register
                  </Link>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Asset history" subtitle="Every recorded change" />
            <div className="max-h-[480px] overflow-y-auto px-5 py-4">
              {history.length === 0 ? (
                <EmptyState icon={<History className="h-5 w-5" />} title="No history yet" />
              ) : (
                <ol className="relative space-y-4 border-l border-slate-200 pl-4">
                  {history.map((h: any) => (
                    <li key={h.id} className="relative">
                      <span className="absolute -left-[22px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-400" />
                      <p className="text-[11.5px] font-semibold text-ink">{humanise(h.event.replace(/([A-Z])/g, ' $1'))}</p>
                      {h.fromHolder || h.toHolder ? (
                        <p className="text-[11px] text-slate-500">
                          {h.fromHolder ?? 'Stock'} → {h.toHolder ?? 'Stock'}
                        </p>
                      ) : null}
                      <p className="text-[11px] text-slate-600">{h.note}</p>
                      <p className="text-[10px] text-slate-400">{h.byName ?? 'System'} · {dateTime(h.at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Assign this asset"
        footer={
          <>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={act.isPending}>Cancel</Button>
            <Button loading={act.isPending} onClick={() => act.mutate({ path: `/assets/${id}/assign`, body: destinationPayload })}>
              Assign asset
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {isPerson ? (
            <Field label="Assign to staff member" required>
              <Select value={destination.holderStaffId} onChange={(e) => setDestination({ ...destination, holderStaffId: e.target.value })}>
                <option value="">Select a staff member…</option>
                {(meta.data?.staff ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name} — {s.jobTitle ?? 'Staff'}</option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Place in room" required>
              <Select value={destination.roomId} onChange={(e) => setDestination({ ...destination, roomId: e.target.value })}>
                <option value="">Select a room…</option>
                {(meta.data?.rooms ?? []).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Note">
            <Input value={destination.note} onChange={(e) => setDestination({ ...destination, note: e.target.value })} />
          </Field>
          <Callout tone="info">An already assigned asset cannot be assigned again — use a transfer instead.</Callout>
        </div>
      </Modal>

      <Modal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        title="Transfer this asset"
        description="The stock manager must confirm every transfer."
        footer={
          <>
            <Button variant="outline" onClick={() => setTransferOpen(false)} disabled={act.isPending}>Cancel</Button>
            <Button loading={act.isPending} onClick={() => act.mutate({ path: `/assets/${id}/transfer`, body: destinationPayload })}>
              Request transfer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {isPerson ? (
            <Field label="New holder" required>
              <Select value={destination.holderStaffId} onChange={(e) => setDestination({ ...destination, holderStaffId: e.target.value })}>
                <option value="">Select a staff member…</option>
                {(meta.data?.staff ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="New room" required>
              <Select value={destination.roomId} onChange={(e) => setDestination({ ...destination, roomId: e.target.value })}>
                <option value="">Select a room…</option>
                {(meta.data?.rooms ?? []).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Reason / note">
            <Textarea value={destination.note} onChange={(e) => setDestination({ ...destination, note: e.target.value })} className="min-h-[70px]" />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        onConfirm={() => act.mutate({ path: `/assets/${id}/return`, body: { note: 'Returned to stock.' } })}
        title="Return this asset to stock?"
        message="The return is recorded as pending until the stock manager confirms it. Once confirmed the asset is available for issue again."
        confirmLabel="Request return"
        tone="primary"
        loading={act.isPending}
      />

      <Modal
        open={disposalOpen}
        onClose={() => setDisposalOpen(false)}
        title="Propose a disposal"
        description="The stock manager must approve before the asset can be disposed of."
        footer={
          <>
            <Button variant="outline" onClick={() => setDisposalOpen(false)} disabled={act.isPending}>Cancel</Button>
            <Button variant="danger" loading={act.isPending} onClick={() => act.mutate({ path: '/disposals', body: { assetId: id, method: disposal.method, reason: disposal.reason } })}>
              Propose disposal
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Disposal method" required>
            <Select value={disposal.method} onChange={(e) => setDisposal({ ...disposal, method: e.target.value })}>
              {Object.entries(DISPOSAL_METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" required>
            <Textarea value={disposal.reason} onChange={(e) => setDisposal({ ...disposal, reason: e.target.value })} placeholder="Why should this asset be disposed of?" />
          </Field>
          <Callout tone="warning">Only an available asset can be proposed. An assigned asset must be returned first.</Callout>
        </div>
      </Modal>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-[13px] font-medium text-ink ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}
