import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, ClipboardList, Filter, Plus, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Pagination,
  SearchInput,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';
import { PriorityBadge, RequestStatusBadge } from '../components/badges';
import { relativeTime } from '../lib/format';
import { PRIORITY_LABELS, REQUEST_STATUS_LABELS } from '@shared/domain';

export function RequestsPage() {
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('raisedAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const scope = params.get('scope') ?? 'all';

  const query = useQuery({
    queryKey: ['requests', { search, status, priority, scope, page, sort, dir }],
    queryFn: () =>
      api<any>(
        `/requests?q=${encodeURIComponent(search)}&status=${status}&priority=${priority}&scope=${scope}&page=${page}&pageSize=10&sort=${sort}&dir=${dir}`,
      ),
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };

  const toggleSort = (field: string) => {
    if (sort === field) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(field);
      setDir('desc');
    }
  };

  const privileged = hasRole('administrator') || hasRole('stock_manager') || hasRole('financial_executive');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Requests</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Every request carries a justification, a priority and its full history — from submission through review,
            approvals and handover.
          </p>
        </div>
        <Button onClick={() => navigate('/requests/new')} icon={<Plus className="h-4 w-4" />}>
          New request
        </Button>
      </div>

      <Card className="p-4">
        <div className="grid gap-2.5 md:grid-cols-[1.6fr_1fr_1fr_1fr_auto]">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search by request ID, justification or recipient…"
          />
          <Select value={status} onChange={(e) => setParam('status', e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(REQUEST_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={priority} onChange={(e) => setParam('priority', e.target.value)}>
            <option value="">All priorities</option>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={scope} onChange={(e) => setParam('scope', e.target.value)}>
            <option value="all">All I can see</option>
            <option value="mine">Raised by or for me</option>
            {privileged ? <option value="team">My team</option> : null}
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              setSearch('');
              setParams(new URLSearchParams(), { replace: true });
              setPage(1);
            }}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
          >
            Reset
          </Button>
        </div>
        <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400">
          <Filter className="h-3 w-3" />
          {privileged
            ? 'You can see requests across the organisation because of your role.'
            : 'You see requests you raised, requests raised for you and requests you reviewed.'}
        </p>
      </Card>

      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : query.isError ? (
          <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />
        ) : query.data.rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title="No requests match these filters"
            message="Try clearing the filters, or raise a new request."
            action={<Button size="sm" onClick={() => navigate('/requests/new')}>Raise a request</Button>}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th onClick={() => toggleSort('ref')}>
                    <span className="inline-flex items-center gap-1">Request <ArrowDownUp className="h-3 w-3" /></span>
                  </Th>
                  <Th>Raised by / for</Th>
                  <Th>Items</Th>
                  <Th onClick={() => toggleSort('priority')}>Priority</Th>
                  <Th onClick={() => toggleSort('status')}>Status</Th>
                  <Th>Current reviewer</Th>
                  <Th onClick={() => toggleSort('raisedAt')}>Raised</Th>
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map((r: any) => (
                  <tr key={r.id} className="cursor-pointer transition-colors hover:bg-slate-50" onClick={() => navigate(`/requests/${r.id}`)}>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Link to={`/requests/${r.id}`} className="text-xs font-semibold text-brand-600 hover:underline">
                          {r.ref}
                        </Link>
                        {r.isGroup ? (
                          <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700 ring-1 ring-violet-200">
                            Group
                          </span>
                        ) : null}
                      </div>
                      <p className="max-w-[260px] truncate text-[11px] text-slate-400">{r.justification}</p>
                    </Td>
                    <Td>
                      <p className="text-xs font-medium text-ink">{r.raisedForName}</p>
                      <p className="text-[11px] text-slate-400">{r.isGroup ? `${r.raisedByName} (group)` : `by ${r.raisedByName}`}</p>
                    </Td>
                    <Td>
                      <p className="max-w-[180px] truncate text-xs text-slate-600">{r.items}</p>
                      <p className="text-[11px] text-slate-400">
                        {r.issuedCount} of {r.itemCount} issued
                      </p>
                    </Td>
                    <Td><PriorityBadge priority={r.priority} /></Td>
                    <Td><RequestStatusBadge status={r.status} /></Td>
                    <Td className="text-xs text-slate-600">{r.currentReviewerName ?? '—'}</Td>
                    <Td className="text-[11px] text-slate-500">{relativeTime(r.raisedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <p className="text-[11px] text-slate-400">
        Signed in as {user?.name}. A rejected request is closed, but a returned one stays open — edit it and resubmit from
        the request page.
      </p>
    </div>
  );
}
