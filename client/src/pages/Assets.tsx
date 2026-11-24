import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, Boxes, PackagePlus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Pagination,
  SearchInput,
  Select,
  Spinner,
  Table,
  Td,
  Th,
  useToast,
} from '../components/ui';
import { AssetStatusBadge } from '../components/badges';
import { ASSET_STATUS_LABELS } from '@shared/domain';
import { shortDate } from '../lib/format';

export function AssetsPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [typeId, setTypeId] = useState('');
  const [scope, setScope] = useState(params.get('scope') ?? 'all');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('registeredAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [registerOpen, setRegisterOpen] = useState(params.get('register') === '1');
  const [form, setForm] = useState({ assetTypeId: '', serialNumber: '', condition: 'good', holderStaffId: '', roomId: '', notes: '' });

  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<any>('/meta') });
  const query = useQuery({
    queryKey: ['assets', { search, status, typeId, scope, page, sort, dir }],
    queryFn: () =>
      api<any>(
        `/assets?q=${encodeURIComponent(search)}&status=${status}&assetTypeId=${typeId}&scope=${scope}&page=${page}&pageSize=10&sort=${sort}&dir=${dir}`,
      ),
  });

  useEffect(() => {
    setStatus(params.get('status') ?? '');
    setScope(params.get('scope') ?? 'all');
    if (params.get('register') === '1') setRegisterOpen(true);
  }, [params]);

  const selectedType = (meta.data?.assetTypes ?? []).find((t: any) => t.id === form.assetTypeId);

  const register = useMutation({
    mutationFn: (payload: any) => api<any>('/assets', { method: 'POST', body: payload }),
    onSuccess: (res) => {
      push(`Asset ${res.ref} registered.`, 'success');
      setRegisterOpen(false);
      setForm({ assetTypeId: '', serialNumber: '', condition: 'good', holderStaffId: '', roomId: '', notes: '' });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const toggleSort = (field: string) => {
    if (sort === field) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(field);
      setDir('desc');
    }
  };

  const canRegister = hasRole('stock_manager') || hasRole('administrator');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Assets</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every physical item is tracked individually — serial number, condition, holder or location, and full history.
          </p>
        </div>
        {canRegister ? (
          <Button onClick={() => setRegisterOpen(true)} icon={<PackagePlus className="h-4 w-4" />}>
            Register existing asset
          </Button>
        ) : null}
      </div>

      <Card className="p-4">
        <div className="grid gap-2.5 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search by asset ID, serial, type, holder or room…"
          />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
          <Select value={typeId} onChange={(e) => { setTypeId(e.target.value); setPage(1); }}>
            <option value="">All asset types</option>
            {(meta.data?.assetTypes ?? []).map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <Select value={scope} onChange={(e) => { setScope(e.target.value); setPage(1); }}>
            <option value="all">{canRegister ? 'All assets' : 'All assets I can see'}</option>
            <option value="mine">Held by me</option>
          </Select>
        </div>
      </Card>

      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : query.isError ? (
          <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />
        ) : query.data.rows.length === 0 ? (
          <EmptyState
            icon={<Boxes className="h-6 w-6" />}
            title="No assets match these filters"
            message="Register an asset found in the store, or issue one from a fulfilled request."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th onClick={() => toggleSort('ref')}><span className="inline-flex items-center gap-1">Asset <ArrowDownUp className="h-3 w-3" /></span></Th>
                  <Th onClick={() => toggleSort('name')}>Type</Th>
                  <Th>Serial number</Th>
                  <Th>Condition</Th>
                  <Th onClick={() => toggleSort('status')}>Status</Th>
                  <Th>Held by</Th>
                  <Th onClick={() => toggleSort('registeredAt')}>Registered</Th>
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map((a: any) => (
                  <tr key={a.id} className="cursor-pointer transition-colors hover:bg-slate-50" onClick={() => navigate(`/assets/${a.id}`)}>
                    <Td>
                      <Link to={`/assets/${a.id}`} className="text-xs font-semibold text-brand-600 hover:underline">{a.ref}</Link>
                    </Td>
                    <Td>
                      <p className="text-xs font-medium text-ink">{a.assetTypeName}</p>
                      <p className="text-[10.5px] text-slate-400">{a.custodyKind === 'person' ? 'Person custody' : 'Location custody'}</p>
                    </Td>
                    <Td className="font-mono text-[11px] text-slate-600">{a.serialNumber ?? '—'}</Td>
                    <Td className="text-xs capitalize text-slate-600">{a.condition}</Td>
                    <Td><AssetStatusBadge status={a.status} /></Td>
                    <Td className="text-xs text-slate-600">{a.holderName ?? a.roomName ?? <span className="text-slate-400">In stock</span>}</Td>
                    <Td className="text-[11px] text-slate-500">{shortDate(a.registeredAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        title="Register an existing asset"
        description="For items already in the store with no request or purchase behind them."
        footer={
          <>
            <Button variant="outline" onClick={() => setRegisterOpen(false)} disabled={register.isPending}>Cancel</Button>
            <Button loading={register.isPending} onClick={() => register.mutate({
              assetTypeId: form.assetTypeId,
              serialNumber: form.serialNumber || null,
              condition: form.condition,
              holderStaffId: selectedType?.custodyKind === 'person' ? form.holderStaffId || null : null,
              roomId: selectedType?.custodyKind === 'location' ? form.roomId || null : null,
              notes: form.notes || null,
            })}>
              Register asset
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Asset type" required>
            <Select value={form.assetTypeId} onChange={(e) => setForm({ ...form, assetTypeId: e.target.value, holderStaffId: '', roomId: '' })}>
              <option value="">Select an asset type…</option>
              {(meta.data?.assetTypes ?? []).map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Serial number" hint="Optional for low-value items; every item still gets its own asset ID.">
            <Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
          </Field>
          <Field label="Condition" required>
            <Select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
              <option value="new">New</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </Select>
          </Field>
          {selectedType?.custodyKind === 'person' ? (
            <Field label="Current holder" hint="Leave empty to keep it in stock.">
              <Select value={form.holderStaffId} onChange={(e) => setForm({ ...form, holderStaffId: e.target.value })}>
                <option value="">In stock — no holder</option>
                {(meta.data?.staff ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
          ) : selectedType?.custodyKind === 'location' ? (
            <Field label="Current room" hint="Leave empty to keep it in stock.">
              <Select value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })}>
                <option value="">In stock — no location</option>
                {(meta.data?.rooms ?? []).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Notes">
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. found in the 2nd floor store room" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
