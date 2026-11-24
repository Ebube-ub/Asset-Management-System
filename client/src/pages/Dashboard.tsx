import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileSpreadsheet,
  PackageCheck,
  PackageSearch,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import { useAuth } from '../lib/auth';
import { api, downloadCsv } from '../lib/api';
import { bg } from '../lib/tones';
import { naira, relativeTime } from '../lib/format';
import { Button, Card, CardHeader, EmptyState, ErrorState, Progress, Spinner, cn } from '../components/ui';
import { PriorityBadge, RequestStatusBadge } from '../components/badges';
import { PRIORITY_LABELS, type Priority } from '@shared/domain';

const PRIORITY_TONE: Record<string, string> = {
  Critical: 'bg-red-500',
  High: 'bg-orange-500',
  Medium: 'bg-brand-500',
  Low: 'bg-slate-400',
};

export function DashboardPage() {
  const { can, hasRole } = useAuth();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<any>('/dashboard') });

  if (query.isLoading) return <Spinner label="Loading your dashboard…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const d = query.data;

  const isAdmin = hasRole('administrator');
  const isStock = hasRole('stock_manager');
  const isFinance = hasRole('financial_executive');
  const isManager = hasRole('team_lead') || hasRole('line_manager');

  const stats: { label: string; value: string; note: string; icon: React.ReactNode; tone: string; href: string }[] = [];
  if (isAdmin) {
    stats.push(
      { label: 'Registered assets', value: d.metrics.assets.total, note: `${d.metrics.assets.assigned} assigned to people or rooms`, icon: <Boxes className="h-5 w-5" />, tone: 'blue', href: '/assets' },
      { label: 'Available in stock', value: d.metrics.assets.available, note: 'Ready to issue from the register', icon: <PackageCheck className="h-5 w-5" />, tone: 'green', href: '/assets?status=available' },
      { label: 'Pending requests', value: d.metrics.requests.pendingReview + d.metrics.requests.inProgress, note: `${d.metrics.requests.pendingReview} under review · ${d.metrics.requests.inProgress} in progress`, icon: <ClipboardList className="h-5 w-5" />, tone: 'amber', href: '/requests' },
      { label: 'Awaiting finance', value: d.metrics.items.awaitingDecision, note: `${d.metrics.staff.staff} active staff · ${d.metrics.staff.left} left`, icon: <Wallet className="h-5 w-5" />, tone: 'violet', href: '/financial-approvals' },
    );
  } else if (isStock) {
    stats.push(
      { label: 'Available stock', value: d.metrics.assets.available, note: `${d.metrics.assets.total} registered in total`, icon: <PackageCheck className="h-5 w-5" />, tone: 'green', href: '/assets?status=available' },
      { label: 'Awaiting stock checks', value: d.metrics.items.requested, note: 'Requested units not yet checked', icon: <PackageSearch className="h-5 w-5" />, tone: 'blue', href: '/stock' },
      { label: 'Awaiting quotations', value: d.metrics.items.awaitingQuotation, note: 'Shortages needing vendor quotes', icon: <FileSpreadsheet className="h-5 w-5" />, tone: 'violet', href: '/quotations' },
      { label: 'Awaiting issuance', value: d.metrics.items.purchased, note: `${d.metrics.items.approved} approved for purchase`, icon: <ShoppingCart className="h-5 w-5" />, tone: 'amber', href: '/purchases' },
    );
  } else if (isFinance) {
    stats.push(
      { label: 'Pending decisions', value: d.metrics.items.awaitingDecision, note: 'Approve, decline or defer', icon: <Wallet className="h-5 w-5" />, tone: 'amber', href: '/financial-approvals' },
      { label: 'High & critical open', value: d.metrics.requests.highPriority, note: 'Priority requests in flight', icon: <ClipboardCheck className="h-5 w-5" />, tone: 'red', href: '/requests?priority=critical' },
      { label: 'Parked items', value: d.metrics.items.parked, note: `${d.metrics.items.dueForReview} due for review`, icon: <RefreshCw className="h-5 w-5" />, tone: 'violet', href: '/financial-approvals' },
      { label: 'Approved spending', value: naira(d.metrics.spending?.approved), note: `${naira(d.metrics.spending?.spent)} spent · ${d.metrics.spending?.overBudget ?? 0} over budget`, icon: <ShieldCheck className="h-5 w-5" />, tone: 'green', href: '/reports' },
    );
  } else {
    stats.push(
      { label: 'My requests', value: d.myStatusCounts.total, note: `${d.myStatusCounts.inProgress} in progress · ${d.myStatusCounts.underReview} under review`, icon: <ClipboardList className="h-5 w-5" />, tone: 'blue', href: '/requests?scope=mine' },
      { label: 'Awaiting review', value: d.myStatusCounts.underReview, note: 'With a reviewer in your chain', icon: <ClipboardCheck className="h-5 w-5" />, tone: 'amber', href: '/requests?scope=mine' },
      { label: 'Assets assigned to me', value: d.myAssets.length, note: 'Held in your name', icon: <Boxes className="h-5 w-5" />, tone: 'green', href: '/assets?scope=mine' },
      { label: 'Completed requests', value: d.myStatusCounts.fulfilled, note: 'Fulfilled end to end', icon: <PackageCheck className="h-5 w-5" />, tone: 'violet', href: '/requests?scope=mine' },
    );
    if (isManager) {
      stats[1] = { label: 'Awaiting my review', value: d.reviewQueue, note: `${d.teamSize} people in your team`, icon: <ClipboardCheck className="h-5 w-5" />, tone: 'amber', href: '/approvals' };
    }
  }

  const priorityData = (['critical', 'high', 'medium', 'low'] as Priority[]).map((p) => ({
    priority: PRIORITY_LABELS[p],
    count: d.byPriority.find((x: any) => x.priority === p)?.count ?? 0,
  }));
  const maxPriority = Math.max(1, ...priorityData.map((p) => p.count));

  const assetSplit = [
    { name: 'Available', value: d.metrics.assets.available, color: '#10B981' },
    { name: 'Assigned', value: d.metrics.assets.assigned, color: '#1769AA' },
    { name: 'Awaiting disposal', value: d.metrics.assets.awaitingDisposal, color: '#F59E0B' },
    { name: 'Disposed', value: d.metrics.assets.disposed, color: '#94A3B8' },
  ].filter((s) => s.value > 0);

  const quickActions = buildQuickActions({ isAdmin, isStock, isFinance, isManager, navigate });

  const activity = isAdmin || isManager ? d.activity : d.myActivity;
  const canSeeReports = can('reports');
  const canSeeAssets = can('assets');

  const exportSummary = () => {
    downloadCsv(
      'i4nnova-dashboard.csv',
      [
        { key: 'metric', label: 'Metric' },
        { key: 'value', label: 'Value' },
      ],
      [
        { metric: 'Registered assets', value: d.metrics.assets.total },
        { metric: 'Available assets', value: d.metrics.assets.available },
        { metric: 'Assigned assets', value: d.metrics.assets.assigned },
        { metric: 'Assets awaiting disposal', value: d.metrics.assets.awaitingDisposal },
        { metric: 'Total staff', value: d.metrics.staff.staff },
        { metric: 'Pending requests', value: d.metrics.requests.pendingReview },
        { metric: 'Items awaiting financial decision', value: d.metrics.items.awaitingDecision },
        { metric: 'Items awaiting quotation', value: d.metrics.items.awaitingQuotation },
        { metric: 'Approved spending', value: d.metrics.spending?.approved ?? 0 },
        { metric: 'Recorded spend', value: d.metrics.spending?.spent ?? 0 },
        ...priorityData.map((p) => ({ metric: `Open ${p.priority} requests`, value: p.count })),
      ],
    );
  };

  return (
    <div className="space-y-5">
      {/* Welcome banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-500 to-brand-600 p-5 text-white shadow-lg shadow-brand-500/10 sm:p-6">
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="absolute -bottom-24 right-24 h-56 w-56 rounded-full bg-white/5" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Welcome back, {d.greeting}</h1>
              <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium text-white/85 ring-1 ring-white/15">
                {format(new Date(), 'EEEE, d MMMM yyyy')}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-white/70">
              Here is what is happening across requests, stock and the asset register.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportSummary}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-medium text-white ring-1 ring-white/20 hover:bg-white/25"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
            <button
              onClick={() => query.refetch()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-medium text-white ring-1 ring-white/20 hover:bg-white/25"
              aria-label="Refresh dashboard"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', query.isFetching && 'animate-spin')} />
            </button>
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Open requests', value: d.metrics.requests.pendingReview + d.metrics.requests.inProgress, note: `${d.metrics.requests.highPriority} high or critical` },
            { label: 'Items in flight', value: d.metrics.items.awaitingQuotation + d.metrics.items.awaitingDecision + d.metrics.items.approved + d.metrics.items.purchased, note: `${d.metrics.items.issued} issued to date` },
            { label: 'Assets registered', value: d.metrics.assets.total, note: `${d.metrics.assets.available} available now` },
            { label: 'Approved spend', value: naira(d.metrics.spending?.approved), note: d.settings.secondApproverName ? `2nd approver: ${d.settings.secondApproverName}` : 'No second approver set' },
          ].map((c) => (
            <div key={c.label} className="rounded-xl bg-white/10 p-3.5 ring-1 ring-white/10 backdrop-blur-sm">
              <p className="text-[11px] font-medium text-white/65">{c.label}</p>
              <p className="mt-1 text-xl font-bold sm:text-2xl">{c.value}</p>
              <p className="mt-0.5 text-[10.5px] text-white/50">{c.note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.href} className="group">
            <Card className="h-full p-4 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', bg(s.tone))}>{s.icon}</span>
                <ArrowUpRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-brand-400" />
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-ink">{s.value}</p>
              <p className="text-xs font-medium text-slate-500">{s.label}</p>
              <p className="mt-2 text-[11px] text-slate-400">{s.note}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        {/* Analytics */}
        <Card>
          <CardHeader
            title="Request activity"
            subtitle="Requests raised over the last six months"
            action={
              canSeeReports ? (
                <Link to="/reports" className="text-xs font-semibold text-brand-500 hover:underline">
                  View reports
                </Link>
              ) : null
            }
          />
          <div className="px-3 pb-2 pt-4">
            {d.monthly.length ? (
              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={d.monthly} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#287FE8" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#287FE8" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#7A8494' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#7A8494' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: '1px solid #e8ecf3', fontSize: 12 }}
                    labelStyle={{ fontWeight: 600, color: '#172033' }}
                  />
                  <Area type="monotone" dataKey="requests" name="Raised" stroke="#1769AA" strokeWidth={2.2} fill="url(#reqFill)" />
                  <Area type="monotone" dataKey="fulfilled" name="Completed" stroke="#10B981" strokeWidth={2} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="No requests yet" message="Charts populate as soon as requests are raised." />
            )}
          </div>
          <div className="border-t border-slate-100 px-5 py-4">
            <p className="mb-3 text-xs font-semibold text-slate-600">Requests by priority</p>
            <div className="space-y-2.5">
              {priorityData.map((p) => (
                <div key={p.priority} className="flex items-center gap-3">
                  <span className="w-16 text-[11px] font-medium text-slate-500">{p.priority}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn('h-full rounded-full', PRIORITY_TONE[p.priority])}
                      style={{ width: `${(p.count / maxPriority) * 100}%` }}
                    />
                  </div>
                  <span className="w-5 text-right text-[11px] font-semibold text-slate-600">{p.count}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Asset register"
              subtitle="Where every item sits today"
              action={<span className="text-[11px] font-semibold text-slate-400">{d.metrics.assets.total} assets</span>}
            />
            <div className="flex flex-col items-center gap-3 px-4 py-4 sm:flex-row">
              {assetSplit.length ? (
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={assetSplit} dataKey="value" innerRadius={42} outerRadius={64} paddingAngle={3}>
                      {assetSplit.map((s) => (
                        <Cell key={s.name} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e8ecf3', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-8 text-xs text-slate-500">No assets registered yet.</p>
              )}
              <div className="w-full space-y-2">
                {assetSplit.map((s) => (
                  <div key={s.name} className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                    <span className="font-semibold text-slate-700">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Live activity" subtitle="The latest recorded events" action={<span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Live</span>} />
            <div className="max-h-[240px] overflow-y-auto px-2 py-2">
              {activity.length === 0 ? (
                <EmptyState title="No activity yet" message="Request and asset events appear here as they happen." />
              ) : (
                activity.slice(0, 6).map((a: any) => (
                  <Link
                    key={a.id}
                    to={a.requestId ? `/requests/${a.requestId}` : a.assetId ? `/assets/${a.assetId}` : '/dashboard'}
                    className="flex gap-2.5 rounded-xl px-2.5 py-2 hover:bg-slate-50"
                  >
                    <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500">
                      <ClipboardList className="h-3 w-3" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11.5px] text-slate-700">
                        <span className="font-semibold text-ink">{a.byName ?? 'System'}</span> · {a.note ?? a.event}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        {a.ref} · {relativeTime(a.at)}
                      </span>
                    </span>
                  </Link>
                ))
              )}
            </div>
            {canSeeReports ? (
              <Link to="/reports" className="block border-t border-slate-100 px-4 py-2.5 text-center text-[11px] font-semibold text-brand-500 hover:bg-slate-50">
                View all activity in reports
              </Link>
            ) : null}
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        {/* Quick actions */}
        <Card>
          <CardHeader title="Quick actions" subtitle="Frequently used tasks in your role" />
          <div className="grid grid-cols-2 gap-3 p-4">
            {quickActions.map((a) => (
              <button
                key={a.label}
                onClick={() => navigate(a.to)}
                className={cn('group rounded-xl p-4 text-left text-white transition-transform hover:-translate-y-0.5', a.color)}
              >
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">{a.icon}</div>
                <p className="text-[13px] font-semibold">{a.label}</p>
                <p className="mt-0.5 text-[10.5px] text-white/70">{a.copy}</p>
              </button>
            ))}
          </div>
        </Card>

        {/* Top categories + recent requests */}
        <Card>
          <CardHeader
            title="Top asset categories"
            subtitle="Registered assets by category"
            action={
              canSeeAssets ? (
                <Link to="/assets" className="text-[11px] font-semibold text-brand-500 hover:underline">
                  View all
                </Link>
              ) : null
            }
          />
          <div className="p-4">
            {d.topCategories.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">No assets registered yet.</p>
            ) : (
              <div className="space-y-3">
                {d.topCategories.map((c: any, i: number) => (
                  <div key={c.name} className="flex items-center gap-3">
                    <span
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold',
                        ['bg-brand-50 text-brand-600', 'bg-emerald-50 text-emerald-600', 'bg-violet-50 text-violet-600', 'bg-amber-50 text-amber-600', 'bg-slate-100 text-slate-600'][i % 5],
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink">{c.name}</p>
                      <Progress value={(c.count / Math.max(1, d.topCategories[0].count)) * 100} tone={i === 0 ? 'blue' : i === 1 ? 'green' : 'violet'} />
                    </div>
                    <span className="text-xs font-semibold text-slate-600">{c.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Pending actions */}
      <Card>
        <CardHeader
          title="Outstanding actions"
          subtitle="Items requiring attention right now"
          action={
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-600 ring-1 ring-red-100">
              {d.outstanding.reduce((sum: number, o: any) => sum + o.count, 0)} pending
            </span>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {d.outstanding.length === 0 ? (
            <div className="col-span-full">
              <EmptyState title="Everything is up to date" message="No queues are waiting on your role." />
            </div>
          ) : (
            d.outstanding.map((o: any) => (
              <Link
                key={o.key}
                to={o.href}
                className={cn(
                  'group rounded-xl border p-4 transition-colors',
                  o.count > 0 ? bg(o.tone, 'soft') : 'border-slate-200 bg-slate-50/60',
                )}
              >
                <div className="flex items-start justify-between">
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', bg(o.tone))}>
                    <ClipboardCheck className="h-4 w-4" />
                  </span>
                  <span className={cn('text-lg font-bold', o.count > 0 ? 'text-ink' : 'text-slate-300')}>{o.count}</span>
                </div>
                <p className="mt-2 text-[13px] font-semibold text-ink">{o.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{o.description}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 group-hover:underline">
                  Open queue <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            ))
          )}
        </div>
      </Card>

      {/* Recent requests */}
      <Card>
        <CardHeader
          title={isAdmin || isStock || isFinance ? 'Recent requests' : 'My recent requests'}
          subtitle={isAdmin || isStock || isFinance ? 'The newest requests across the organisation' : 'Requests you raised or that were raised for you'}
          action={
            <div className="flex gap-2">
              {(isAdmin || isStock || isFinance || isManager) && (
                <Button size="sm" variant="outline" onClick={() => navigate('/requests')}>
                  View all
                </Button>
              )}
              <Button size="sm" onClick={() => navigate('/requests/new')} icon={<Plus className="h-3.5 w-3.5" />}>
                New request
              </Button>
            </div>
          }
        />
        <div className="table-scroll">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                {['Request', 'Raised for', 'Items', 'Priority', 'Status', 'Raised'].map((h) => (
                  <th key={h} className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.myRequests.length === 0 && d.activity.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="No requests yet"
                      message="Raise a request and it will appear here with its full review history."
                      action={<Button size="sm" onClick={() => navigate('/requests/new')}>Raise a request</Button>}
                    />
                  </td>
                </tr>
              ) : (
                (isAdmin || isStock || isFinance ? d.recentRequests : isManager ? d.recentRequests : d.myRequests).map((r: any) => (
                  <tr key={r.id} className="cursor-pointer transition-colors hover:bg-slate-50" onClick={() => navigate(`/requests/${r.id}`)}>
                    <td className="border-b border-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold text-ink">{r.ref}</p>
                      <p className="max-w-[220px] truncate text-[11px] text-slate-400">{r.justification}</p>
                    </td>
                    <td className="border-b border-slate-50 px-4 py-3 text-xs text-slate-600">{r.raisedForName}</td>
                    <td className="border-b border-slate-50 px-4 py-3 text-xs text-slate-600">{r.items ?? r.itemCount}</td>
                    <td className="border-b border-slate-50 px-4 py-3"><PriorityBadge priority={r.priority} /></td>
                    <td className="border-b border-slate-50 px-4 py-3"><RequestStatusBadge status={r.status} /></td>
                    <td className="border-b border-slate-50 px-4 py-3 text-[11px] text-slate-500">{relativeTime(r.raisedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function buildQuickActions({
  isAdmin,
  isStock,
  isFinance,
  isManager,
  navigate,
}: {
  isAdmin: boolean;
  isStock: boolean;
  isFinance: boolean;
  isManager: boolean;
  navigate: (to: string) => void;
}) {
  if (isAdmin) {
    return [
      { label: 'Review requests', copy: 'Approve or reject', icon: <ClipboardCheck className="h-4 w-4" />, color: 'bg-brand-500', to: '/approvals' },
      { label: 'Manage staff', copy: 'Roles and reporting lines', icon: <Users className="h-4 w-4" />, color: 'bg-emerald-600', to: '/staff' },
      { label: 'Organisation', copy: 'Teams and line managers', icon: <UserCog className="h-4 w-4" />, color: 'bg-orange-500', to: '/organisation' },
      { label: 'Settings', copy: 'Weights and review period', icon: <Settings2 className="h-4 w-4" />, color: 'bg-violet-500', to: '/settings' },
    ];
  }
  if (isStock) {
    return [
      { label: 'Stock check', copy: 'Issue available items', icon: <PackageSearch className="h-4 w-4" />, color: 'bg-brand-500', to: '/stock' },
      { label: 'Quotations', copy: 'Compare and choose', icon: <FileSpreadsheet className="h-4 w-4" />, color: 'bg-emerald-600', to: '/quotations' },
      { label: 'Record purchase', copy: 'Vendor, cost, receipt', icon: <ShoppingCart className="h-4 w-4" />, color: 'bg-orange-500', to: '/purchases' },
      { label: 'Disposals', copy: 'Approve write-offs', icon: <ShieldCheck className="h-4 w-4" />, color: 'bg-violet-500', to: '/disposals' },
    ];
  }
  if (isFinance) {
    return [
      { label: 'Financial decisions', copy: 'Approve, decline, defer', icon: <Wallet className="h-4 w-4" />, color: 'bg-brand-500', to: '/financial-approvals' },
      { label: 'Quotations', copy: 'Review selected quotes', icon: <FileSpreadsheet className="h-4 w-4" />, color: 'bg-emerald-600', to: '/quotations' },
      { label: 'Purchases', copy: 'Costs and over-budget', icon: <ShoppingCart className="h-4 w-4" />, color: 'bg-orange-500', to: '/purchases' },
      { label: 'Reports', copy: 'Spending and approvals', icon: <ClipboardList className="h-4 w-4" />, color: 'bg-violet-500', to: '/reports' },
    ];
  }
  if (isManager) {
    return [
      { label: 'Review queue', copy: 'Requests awaiting you', icon: <ClipboardCheck className="h-4 w-4" />, color: 'bg-brand-500', to: '/approvals' },
      { label: 'New request', copy: 'Raise for yourself', icon: <Plus className="h-4 w-4" />, color: 'bg-emerald-600', to: '/requests/new' },
      { label: 'My assets', copy: 'What you hold', icon: <Boxes className="h-4 w-4" />, color: 'bg-orange-500', to: '/assets?scope=mine' },
      { label: 'Transfer or return', copy: 'Hand an asset back', icon: <RefreshCw className="h-4 w-4" />, color: 'bg-violet-500', to: '/returns' },
    ];
  }
  return [
    { label: 'New request', copy: 'Ask for equipment', icon: <Plus className="h-4 w-4" />, color: 'bg-brand-500', to: '/requests/new' },
    { label: 'My requests', copy: 'Track progress', icon: <ClipboardList className="h-4 w-4" />, color: 'bg-emerald-600', to: '/requests?scope=mine' },
    { label: 'My assets', copy: 'What you hold', icon: <Boxes className="h-4 w-4" />, color: 'bg-orange-500', to: '/assets?scope=mine' },
    { label: 'Return an asset', copy: 'Request a return', icon: <RefreshCw className="h-4 w-4" />, color: 'bg-violet-500', to: '/returns' },
  ];
}
