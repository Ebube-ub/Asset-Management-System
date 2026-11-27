import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardCheck, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, EmptyState, ErrorState, Spinner } from '../components/ui';
import { PriorityBadge } from '../components/badges';
import { relativeTime } from '../lib/format';

export function ApprovalsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const query = useQuery({ queryKey: ['approvals'], queryFn: () => api<any>('/approvals') });

  if (query.isLoading) return <Spinner label="Loading your review queue…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const { rows, teamSize } = query.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">Purchase Request</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Requests waiting for a decision from you — either your review in the reporting line, or an approval level your
          asset category requires. Approving moves the request on; returning it lets the requester make changes without
          closing it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Awaiting your review</p>
          <p className="mt-1 text-2xl font-bold text-ink">{rows.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">People in your team</p>
          <p className="mt-1 text-2xl font-bold text-ink">{teamSize}</p>
          <p className="mt-0.5 text-[10.5px] text-slate-400">Everyone whose requests reach you</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Your role</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {user?.roles.length ? (
              user.roles.map((r) => (
                <Badge key={r} className="bg-brand-50 text-brand-600 ring-brand-200">
                  {r.replace('_', ' ')}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-slate-500">Staff member</span>
            )}
          </div>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck className="h-6 w-6" />}
            title="Nothing waiting for your review"
            message="When a request in your reporting line reaches you it will appear here, highest priority first."
            action={<Button variant="outline" size="sm" onClick={() => navigate('/requests')}>Browse requests</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r: any) => (
            <Card key={r.id} className="p-4 transition-shadow hover:shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => navigate(`/requests/${r.id}`)} className="text-sm font-semibold text-brand-600 hover:underline">
                      {r.ref}
                    </button>
                    <PriorityBadge priority={r.priority} />
                    {r.kind === 'approval' ? (
                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200">
                        {String(r.requiredRole ?? '').replace('_', ' ')} approval
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                        Reporting-line review
                      </span>
                    )}
                    {r.isGroup ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        Group request
                      </span>
                    ) : null}
                    {r.alreadyPassed > 0 ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {r.alreadyPassed} earlier review{r.alreadyPassed > 1 ? 's' : ''}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-slate-600">{r.justification}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                    <span className="font-medium text-ink">For {r.raisedForName}</span>
                    <span>by {r.raisedByName}</span>
                    <span>{r.itemCount} item(s): {r.items}</span>
                    <span>{relativeTime(r.raisedAt)}</span>
                  </div>
                </div>
                <Button size="sm" onClick={() => navigate(`/requests/${r.id}`)} icon={<ArrowRight className="h-3.5 w-3.5" />}>
                  Review
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-4">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          A request climbs the reporting line one manager at a time. After the reporting-line review, any approval level
          configured on the asset category is cleared before stock is checked. Both steps appear in this queue.
        </p>
      </Card>
    </div>
  );
}
