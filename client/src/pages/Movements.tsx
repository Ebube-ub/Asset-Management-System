import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Check, Undo2, X } from 'lucide-react';
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
  Spinner,
  useToast,
} from '../components/ui';
import { dateTime, humanise } from '../lib/format';

function MovementsPage({ kind }: { kind: 'transfer' | 'return' }) {
  const { hasRole } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['movements', kind], queryFn: () => api<any>(`/movements?kind=${kind}`) });
  const [confirmTarget, setConfirmTarget] = useState<any | null>(null);
  const [action, setAction] = useState<'confirm' | 'reject'>('confirm');

  const canConfirm = hasRole('stock_manager') || hasRole('administrator');

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'confirm' | 'reject' }) =>
      api<any>(`/movements/${id}/${action}`, { method: 'POST' }),
    onSuccess: (_res, vars) => {
      push(vars.action === 'confirm' ? 'Movement confirmed and the register updated.' : 'Movement rejected.', 'success');
      setConfirmTarget(null);
      void qc.invalidateQueries({ queryKey: ['movements', kind] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;

  const rows = query.data.rows;
  const pending = rows.filter((r: any) => r.status === 'pending');
  const past = rows.filter((r: any) => r.status !== 'pending');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">{kind === 'transfer' ? 'Transfers' : 'Returns'}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {kind === 'transfer'
            ? 'Every transfer moves an asset between holders or locations and is confirmed by the stock manager.'
            : 'Staff return assets to stock; the stock manager confirms each return before it takes effect.'}
        </p>
      </div>

      <Callout tone="info" title="Confirmation is required">
        A movement only changes the register once the stock manager confirms it. Until then the asset stays with its current
        holder, and the movement is recorded in the asset history as pending.
      </Callout>

      <Card>
        <CardHeader
          title="Awaiting confirmation"
          subtitle="Oldest first"
          action={<Badge className="bg-amber-50 text-amber-700 ring-amber-200">{pending.length} pending</Badge>}
        />
        {pending.length === 0 ? (
          <EmptyState
            icon={kind === 'transfer' ? <ArrowLeftRight className="h-6 w-6" /> : <Undo2 className="h-6 w-6" />}
            title={`No ${kind}s waiting`}
            message="Requests raised from an asset profile appear here for confirmation."
          />
        ) : (
          <div className="divide-y divide-slate-50">
            {pending.map((m: any) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/assets/${m.assetId}`} className="text-xs font-semibold text-brand-600 hover:underline">
                      {m.ref}
                    </Link>
                    <span className="text-[11px] text-slate-500">{m.assetTypeName}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink">
                    {m.kind === 'transfer' ? (
                      <>
                        From <span className="font-medium">{m.currentHolderName ?? m.currentRoomName}</span> to{' '}
                        <span className="font-medium">{m.toStaffName ?? m.toRoomName}</span>
                      </>
                    ) : (
                      <>Returning from <span className="font-medium">{m.currentHolderName ?? m.currentRoomName}</span> to stock</>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Requested by {m.requestedByName} · {dateTime(m.requestedAt)}
                    {m.note ? ` · ${m.note}` : ''}
                  </p>
                </div>
                {canConfirm ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      icon={<Check className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setAction('confirm');
                        setConfirmTarget(m);
                      }}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<X className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setAction('reject');
                        setConfirmTarget(m);
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                ) : (
                  <Badge className="bg-slate-100 text-slate-600 ring-slate-200">Awaiting stock manager</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="History" subtitle="Confirmed and rejected movements" />
        {past.length === 0 ? (
          <EmptyState title="No movements recorded yet" />
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr>
                  {['Asset', 'Type', 'Direction', 'Status', 'Requested by', 'Confirmed by', 'When'].map((h) => (
                    <th key={h} className="border-b border-slate-100 bg-slate-50/60 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {past.map((m: any) => (
                  <tr key={m.id}>
                    <td className="border-b border-slate-50 px-3 py-2.5">
                      <Link to={`/assets/${m.assetId}`} className="font-semibold text-brand-600 hover:underline">{m.ref}</Link>
                    </td>
                    <td className="border-b border-slate-50 px-3 py-2.5 text-slate-600">{m.assetTypeName}</td>
                    <td className="border-b border-slate-50 px-3 py-2.5 text-slate-600">
                      {m.kind === 'transfer'
                        ? `${m.currentHolderName ?? m.currentRoomName} → ${m.toStaffName ?? m.toRoomName}`
                        : `Return to stock`}
                    </td>
                    <td className="border-b border-slate-50 px-3 py-2.5">
                      <Badge className={m.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}>
                        {humanise(m.status)}
                      </Badge>
                    </td>
                    <td className="border-b border-slate-50 px-3 py-2.5 text-slate-600">{m.requestedByName}</td>
                    <td className="border-b border-slate-50 px-3 py-2.5 text-slate-600">{m.confirmedByName ?? '—'}</td>
                    <td className="border-b border-slate-50 px-3 py-2.5 text-slate-500">{dateTime(m.confirmedAt ?? m.requestedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => confirmTarget && act.mutate({ id: confirmTarget.id, action })}
        title={action === 'confirm' ? 'Confirm this movement?' : 'Reject this movement?'}
        message={
          action === 'confirm'
            ? confirmTarget?.kind === 'transfer'
              ? `The asset will move to ${confirmTarget?.toStaffName ?? confirmTarget?.toRoomName} and the asset history will record the transfer.`
              : 'The asset will return to stock and become available for issue again.'
            : 'The asset stays with its current holder and the movement is recorded as rejected.'
        }
        confirmLabel={action === 'confirm' ? 'Confirm movement' : 'Reject movement'}
        tone={action === 'confirm' ? 'success' : 'danger'}
        loading={act.isPending}
      />
    </div>
  );
}

export function TransfersPage() {
  return <MovementsPage kind="transfer" />;
}

export function ReturnsPage() {
  return <MovementsPage kind="return" />;
}
