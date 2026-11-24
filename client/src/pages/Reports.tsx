import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileSpreadsheet } from 'lucide-react';
import { api, downloadCsv } from '../lib/api';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Spinner, Table, Td, Th, cn } from '../components/ui';
import { naira } from '../lib/format';

type ReportMeta = { key: string; title: string; description: string; group: string };

export function ReportsPage() {
  const index = useQuery({ queryKey: ['reports'], queryFn: () => api<any>('/reports') });
  const [selected, setSelected] = useState<string>('asset-register');
  const report = useQuery({
    queryKey: ['report', selected],
    queryFn: () => api<any>(`/reports/${selected}`),
    enabled: !!selected,
  });

  const groups = useMemo(() => {
    const map = new Map<string, ReportMeta[]>();
    for (const r of index.data?.reports ?? []) {
      map.set(r.group, [...(map.get(r.group) ?? []), r]);
    }
    return [...map.entries()];
  }, [index.data]);

  if (index.isLoading) return <Spinner />;
  if (index.isError) return <ErrorState message={(index.error as Error).message} onRetry={() => index.refetch()} />;

  const active = (index.data.reports as ReportMeta[]).find((r) => r.key === selected);

  const exportReport = () => {
    if (!report.data) return;
    downloadCsv(`${selected}.csv`, report.data.columns, report.data.rows);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">Reports</h1>
        <p className="mt-1 text-sm text-slate-500">
          Live reports built from the register, requests and financial records. Every row can be exported.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit p-3">
          {groups.map(([group, reports]) => (
            <div key={group} className="mb-3 last:mb-0">
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{group}</p>
              <div className="space-y-0.5">
                {reports.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setSelected(r.key)}
                    className={cn(
                      'block w-full rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors',
                      selected === r.key ? 'bg-brand-50 font-semibold text-brand-600' : 'text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>

        <Card>
          <CardHeader
            title={active?.title ?? 'Report'}
            subtitle={active?.description}
            action={
              <div className="flex items-center gap-2">
                <Badge className="bg-slate-100 text-slate-600 ring-slate-200">
                  {report.data?.rows?.length ?? 0} row(s)
                </Badge>
                <Button size="sm" variant="outline" onClick={exportReport} disabled={!report.data?.rows?.length} icon={<Download className="h-3.5 w-3.5" />}>
                  Export CSV
                </Button>
              </div>
            }
          />
          {report.isLoading ? (
            <Spinner />
          ) : report.isError ? (
            <ErrorState message={(report.error as Error).message} onRetry={() => report.refetch()} />
          ) : !report.data?.rows?.length ? (
            <EmptyState icon={<FileSpreadsheet className="h-6 w-6" />} title="No rows for this report" message="Data appears once records exist." />
          ) : (
            <Table>
              <thead>
                <tr>
                  {report.data.columns.map((c: any) => (
                    <Th key={c.key}>{c.label}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.data.rows.map((row: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {report.data.columns.map((c: any) => (
                      <Td key={c.key} className="text-xs">
                        {c.type === 'money'
                          ? row[c.key] != null
                            ? naira(row[c.key])
                            : '—'
                          : c.type === 'status'
                            ? <Badge className="bg-slate-100 text-slate-600 ring-slate-200">{row[c.key]}</Badge>
                            : row[c.key] ?? '—'}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-[10.5px] text-slate-400">
            <BarChart3 className="h-3 w-3" /> Generated from live data · everything shown here is also in the request and
            asset histories.
          </div>
        </Card>
      </div>
    </div>
  );
}
