import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Table,
  Td,
  Th,
  useToast,
} from '../components/ui';
import { ROLE_LABELS, type Role } from '@shared/domain';
import { shortDate } from '../lib/format';

export function StaffPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['staff'], queryFn: () => api<any>('/staff') });
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', jobTitle: '', managerId: '', roles: [] as Role[] });

  const isAdmin = hasRole('administrator');

  const create = useMutation({
    mutationFn: (payload: any) => api<any>('/staff', { method: 'POST', body: payload }),
    onSuccess: (res) => {
      push(res.temporaryPassword ? `Staff member added. Temporary password: ${res.temporaryPassword}` : 'Staff member added.', 'success');
      setAddOpen(false);
      setForm({ name: '', email: '', jobTitle: '', managerId: '', roles: [] });
      void qc.invalidateQueries({ queryKey: ['staff'] });
      void qc.invalidateQueries({ queryKey: ['meta'] });
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;

  const rows = query.data.rows.filter((s: any) =>
    !search ? true : `${s.name} ${s.email} ${s.jobTitle ?? ''} ${(s.roles ?? []).join(' ')}`.toLowerCase().includes(search.toLowerCase()),
  );
  const managers = query.data.rows.filter((s: any) => !s.leftAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Staff Management</h1>
          <p className="mt-1 text-sm text-slate-500">
            Staff records are never deleted. Roles, reporting lines and departure are managed here.
          </p>
        </div>
        {isAdmin ? (
          <Button onClick={() => setAddOpen(true)} icon={<UserPlus className="h-4 w-4" />}>Add staff member</Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Users className="h-5 w-5" /></span>
          <div>
            <p className="text-xl font-bold text-ink">{query.data.totals.total}</p>
            <p className="text-[11px] text-slate-500">Active staff</p>
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Have left</p>
          <p className="mt-1 text-xl font-bold text-ink">{query.data.totals.left}</p>
          <p className="mt-0.5 text-[10.5px] text-slate-400">Records and history preserved</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Line managers</p>
          <p className="mt-1 text-xl font-bold text-ink">{query.data.rows.filter((s: any) => s.roles.includes('line_manager')).length}</p>
          <p className="mt-0.5 text-[10.5px] text-slate-400">The last reviewer before the stock check</p>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search staff by name, email or role…"
              className="w-full rounded-xl border border-slate-200 bg-surface py-2 pl-9 pr-3 text-xs focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <p className="text-[11px] text-slate-400">{rows.length} record(s)</p>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No staff match this search" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Roles</Th>
                <Th>Reports to</Th>
                <Th>Team size</Th>
                <Th>Assets</Th>
                <Th>Pending reviews</Th>
                <Th>Status</Th>
                <Th>First signed in</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s: any) => (
                <tr key={s.id} className="cursor-pointer transition-colors hover:bg-slate-50" onClick={() => navigate(`/staff/${s.id}`)}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={s.name} size="sm" />
                      <div>
                        <p className="text-xs font-semibold text-ink">{s.name}</p>
                        <p className="text-[11px] text-slate-500">{s.jobTitle ?? '—'}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {s.roles.length ? (
                        s.roles.map((r: Role) => (
                          <Badge key={r} className="bg-brand-50 text-brand-600 ring-brand-200">{ROLE_LABELS[r]}</Badge>
                        ))
                      ) : (
                        <Badge>Staff member</Badge>
                      )}
                    </div>
                  </Td>
                  <Td className="text-xs text-slate-600">{s.managerName ?? <span className="text-amber-600">No manager</span>}</Td>
                  <Td className="text-xs text-slate-600">{s.teamSize}</Td>
                  <Td className="text-xs text-slate-600">{s.assetsHeld}</Td>
                  <Td className="text-xs text-slate-600">{s.pendingReviews}</Td>
                  <Td>
                    {s.leftAt ? (
                      <Badge className="bg-slate-100 text-slate-500 ring-slate-200">Left {shortDate(s.leftAt)}</Badge>
                    ) : (
                      <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">Active</Badge>
                    )}
                  </Td>
                  <Td className="text-[11px] text-slate-500">{s.firstSignedInAt ? shortDate(s.firstSignedInAt) : 'Never'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a staff member"
        description="They can sign in once their account exists."
        footer={
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={create.isPending}>Cancel</Button>
            <Button
              loading={create.isPending}
              onClick={() =>
                create.mutate({
                  name: form.name,
                  email: form.email,
                  jobTitle: form.jobTitle || null,
                  managerId: form.managerId || null,
                  roles: form.roles,
                })
              }
            >
              Add staff member
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Full name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Work email" required>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@i4nnova.com" />
          </Field>
          <Field label="Job title">
            <Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </Field>
          <Field label="Reports to" hint="Their requests climb the reporting line from here.">
            <Select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
              <option value="">No manager (top of a chain)</option>
              {managers.map((m: any) => (
                <option key={m.id} value={m.id}>{m.name} — {m.jobTitle ?? 'Staff'}</option>
              ))}
            </Select>
          </Field>
          <Field label="Roles" hint="Team lead is implied by having direct reports.">
            <div className="grid grid-cols-2 gap-2">
              {(['team_lead', 'line_manager', 'stock_manager', 'financial_executive', 'administrator'] as Role[]).map((r) => (
                <label key={r} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.roles.includes(r)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        roles: e.target.checked ? [...form.roles, r] : form.roles.filter((x) => x !== r),
                      })
                    }
                  />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </Field>
          <Callout tone="info">A temporary password is generated and shown once. They should change it after signing in.</Callout>
        </div>
      </Modal>
    </div>
  );
}
