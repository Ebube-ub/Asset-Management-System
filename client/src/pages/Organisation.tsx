import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Building2, Network, Users } from 'lucide-react';
import { api } from '../lib/api';
import { Avatar, Badge, Card, CardHeader, EmptyState, ErrorState, Spinner } from '../components/ui';
import { ROLE_LABELS, type Role } from '@shared/domain';

export function OrganisationPage() {
  const query = useQuery({ queryKey: ['organisation'], queryFn: () => api<any>('/organisation') });
  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const { rows, lineManagers, noManager, totalManagers } = query.data;
  const active = rows.filter((r: any) => !r.leftAt);
  const teamCards = rows.filter((r: any) => r.team.length > 0 && !r.leftAt);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">Organisation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Reporting lines decide the review chain. A line manager's team is everyone whose requests reach them.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Users className="h-5 w-5" /></span>
          <div><p className="text-xl font-bold text-ink">{active.length}</p><p className="text-[11px] text-slate-500">Active staff</p></div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Network className="h-5 w-5" /></span>
          <div><p className="text-xl font-bold text-ink">{lineManagers.length}</p><p className="text-[11px] text-slate-500">Line managers</p></div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Building2 className="h-5 w-5" /></span>
          <div><p className="text-xl font-bold text-ink">{totalManagers}</p><p className="text-[11px] text-slate-500">People managing others</p></div>
        </Card>
      </div>

      {noManager.length ? (
        <Card>
          <CardHeader
            title="Staff with no line manager above them"
            subtitle="Their requests skip line-manager review and go straight to the stock check"
            action={<Badge className="bg-amber-50 text-amber-700 ring-amber-200">{noManager.length}</Badge>}
          />
          <div className="flex flex-wrap gap-2 p-4">
            {noManager.map((s: any) => (
              <Link key={s.id} to={`/staff/${s.id}`} className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs hover:border-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span className="font-medium text-ink">{s.name}</span>
                <span className="text-[10.5px] text-slate-500">{s.jobTitle}</span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {teamCards.length === 0 ? (
          <Card><EmptyState title="No teams yet" message="Assign managers to staff to build the reporting hierarchy." /></Card>
        ) : (
          teamCards.map((m: any) => (
            <Card key={m.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Avatar name={m.name} size="sm" />
                    <span>{m.name}</span>
                  </span>
                }
                subtitle={
                  <span className="flex flex-wrap items-center gap-1.5">
                    {m.jobTitle ?? 'Manager'}
                    {m.roles.map((r: Role) => (
                      <span key={r} className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-brand-600">
                        {ROLE_LABELS[r]}
                      </span>
                    ))}
                  </span>
                }
                action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{m.team.length} in team</Badge>}
              />
              <div className="flex flex-wrap gap-1.5 p-4">
                {m.team.map((t: any) => (
                  <Link
                    key={t.id}
                    to={`/staff/${t.id}`}
                    className={`rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:border-brand-300 hover:bg-brand-50/40 ${t.depth > 1 ? 'border-dashed' : ''}`}
                  >
                    {t.name}
                    {t.depth > 1 ? <span className="ml-1 text-[9px] text-slate-400">depth {t.depth}</span> : null}
                  </Link>
                ))}
              </div>
            </Card>
          ))
        )}
      </div>

      <Card>
        <CardHeader title="Reporting lines" subtitle="Indented by depth from each person's manager" />
        <div className="p-4">
          {active
            .filter((r: any) => !r.managerId)
            .map((root: any) => (
              <Tree key={root.id} node={root} rows={active} depth={0} visited={new Set()} />
            ))}
        </div>
      </Card>
    </div>
  );
}

function Tree({ node, rows, depth, visited }: { node: any; rows: any[]; depth: number; visited: Set<string> }) {
  if (visited.has(node.id)) return null;
  const nextVisited = new Set(visited).add(node.id);
  const reports = rows.filter((r: any) => r.managerId === node.id);
  return (
    <div>
      <Link
        to={`/staff/${node.id}`}
        className="flex items-center gap-2 rounded-lg py-1 text-xs hover:bg-slate-50"
        style={{ paddingLeft: `${depth * 18}px` }}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${depth === 0 ? 'bg-brand-500' : 'bg-slate-300'}`} />
        <span className="font-medium text-ink">{node.name}</span>
        <span className="text-[10.5px] text-slate-400">{node.jobTitle}</span>
        {node.roles.includes('line_manager') ? (
          <span className="rounded bg-violet-50 px-1 py-0.5 text-[9px] font-semibold text-violet-600">line manager</span>
        ) : null}
      </Link>
      {reports.map((r: any) => (
        <Tree key={r.id} node={r} rows={rows} depth={depth + 1} visited={nextVisited} />
      ))}
    </div>
  );
}
