import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileSpreadsheet, Scale } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Spinner } from '../components/ui';
import { PriorityBadge } from '../components/badges';
import { relativeTime } from '../lib/format';

export function QuotationsPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['quotations'], queryFn: () => api<any>('/quotations') });

  if (query.isLoading) return <Spinner label="Loading the quotation queue…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const { rows, weights } = query.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">Quotations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Record vendor quotations per request line, compare them side by side and choose one. The chosen amount becomes
          the approved amount.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Scoring weights in force"
          subtitle="Each recommendation keeps the weights it used"
          action={<span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold text-brand-600">Total 100%</span>}
        />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          {[
            { key: 'price', label: 'Price', hint: 'cheapest ÷ this quote' },
            { key: 'quality', label: 'Quality', hint: 'rating ÷ 5' },
            { key: 'delivery', label: 'Delivery', hint: 'fastest ÷ this quote' },
            { key: 'warranty', label: 'Warranty', hint: 'this ÷ longest' },
          ].map((w) => (
            <div key={w.key} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{w.label}</p>
              <p className="mt-0.5 text-lg font-bold text-ink">{weights[w.key]}%</p>
              <p className="text-[10px] text-slate-400">{w.hint}</p>
            </div>
          ))}
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileSpreadsheet className="h-6 w-6" />}
            title="No lines awaiting quotations"
            message="When the stock manager sends a shortfall for quotes it appears here, highest priority first."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r: any) => (
            <Card key={r.lineId} className="p-4 transition-shadow hover:shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{r.ref}</span>
                    <PriorityBadge priority={r.priority} />
                    <Badge className="bg-slate-100 text-slate-600 ring-slate-200">{relativeTime(r.raisedAt)}</Badge>
                  </div>
                  <p className="mt-1 text-[13px] font-medium text-ink">
                    {r.quantity} × {r.assetTypeName}
                    <span className="ml-1 text-[11px] font-normal text-slate-500">
                      for {r.raisedForName}
                      {r.custodyKind === 'location' ? ` · ${r.roomName}` : ''}
                    </span>
                  </p>
                  <p className="mt-0.5 max-w-xl truncate text-[11px] text-slate-500">{r.justification}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <Badge className="bg-violet-50 text-violet-700 ring-violet-200">{r.quoteCount} quotation(s)</Badge>
                    {r.awaitingCount ? <Badge className="bg-amber-50 text-amber-700 ring-amber-200">{r.awaitingCount} awaiting quote</Badge> : null}
                    {r.hasChoice ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">Quote chosen</Badge> : null}
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/quotations/${r.lineId}`)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-600 hover:bg-brand-100"
                >
                  Compare <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
        <Scale className="mt-0.5 h-3 w-3 shrink-0" />
        The highest score is recommended. On a tie the lower amount wins, then the earliest recorded quotation. Choosing
        another quotation requires a reason, which is kept with the choice.
      </p>
    </div>
  );
}
