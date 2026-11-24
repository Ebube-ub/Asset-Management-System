import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Boxes, DoorClosed, KeyRound, Pencil, ShieldAlert, UserMinus, Users } from 'lucide-react';
import { api } from '../lib/api';
import {
  Avatar,
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
  useToast,
} from '../components/ui';
import { PriorityBadge, RequestStatusBadge, AssetStatusBadge } from '../components/badges';
import { ROLE_LABELS, type Role } from '@shared/domain';
import { shortDate } from '../lib/format';

export function StaffDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['staff-member', id], queryFn: () => api<any>(`/staff/${id}`) });
  const directory = useQuery({ queryKey: ['staff'], queryFn: () => api<any>('/staff') });
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<any>('/meta') });

  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [form, setForm] = useState({ name: '', jobTitle: '', managerId: '', roles: [] as Role[] });

  const staff = query.data?.staff;

  useEffect(() => {
    if (staff) {
      setForm({
        name: staff.name,
        jobTitle: staff.jobTitle ?? '',
        managerId: staff.managerId ?? '',
        roles: staff.roles ?? [],
      });
    }
  }, [staff]);

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['staff-member', id] });
    void qc.invalidateQueries({ queryKey: ['staff'] });
    void qc.invalidateQueries({ queryKey: ['organisation'] });
    void qc.invalidateQueries({ queryKey: ['meta'] });
  };

  const update = useMutation({
    mutationFn: (payload: any) => api<any>(`/staff/${id}`, { method: 'PATCH', body: payload }),
    onSuccess: () => {
      push('Staff record updated.', 'success');
      setEditOpen(false);
      reload();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const reset = useMutation({
    mutationFn: (payload: any) => api<any>(`/staff/${id}/password`, { method: 'POST', body: payload }),
    onSuccess: () => {
      push('Password reset. Existing sessions were signed out.', 'success');
      setPwOpen(false);
      setPassword('');
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const leave = useMutation({
    mutationFn: () => api<any>(`/staff/${id}/leave`, { method: 'POST' }),
    onSuccess: (res) => {
      push(`Marked as left. ${res.cancelledRequests} outstanding request(s) cancelled.`, 'success');
      setLeaveOpen(false);
      reload();
    },
    onError: (e: Error) => {
      push(e.message, 'error');
      setLeaveOpen(false);
    },
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const { assets, requests, team, blockers } = query.data;
  const managers = (directory.data?.rows ?? []).filter((s: any) => !s.leftAt && s.id !== id);

  return (
    <div className="space-y-4">
      <div>
        <button onClick={() => navigate('/staff')} className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-brand-600">
          <ArrowLeft className="h-3 w-3" /> Back to staff
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={staff.name} size="lg" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] font-bold tracking-tight text-ink">{staff.name}</h1>
                {staff.leftAt ? (
                  <Badge className="bg-slate-100 text-slate-600 ring-slate-200">Left {shortDate(staff.leftAt)}</Badge>
                ) : (
                  <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">Active</Badge>
                )}
              </div>
              <p className="text-sm text-slate-500">{staff.jobTitle ?? 'Staff member'} · {staff.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)} icon={<Pencil className="h-4 w-4" />}>Edit record</Button>
            <Button variant="outline" onClick={() => setPwOpen(true)} icon={<KeyRound className="h-4 w-4" />}>Reset password</Button>
            {!staff.leftAt ? (
              <Button variant="danger" onClick={() => setLeaveOpen(true)} icon={<UserMinus className="h-4 w-4" />}>Mark as left</Button>
            ) : null}
          </div>
        </div>
      </div>

      {staff.leftAt ? (
        <Callout tone="warning" title="This staff member has left">
          They cannot sign in, review requests or be anyone's manager. Their history, issued assets and records are kept.
        </Callout>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Profile" />
            <div className="space-y-3 p-5 text-xs">
              <Row label="Reports to" value={staff.managerName ?? <span className="text-amber-600">No manager</span>} />
              <Row label="First signed in" value={staff.firstSignedInAt ? shortDate(staff.firstSignedInAt) : 'Never signed in'} />
              <Row label="Added" value={shortDate(staff.createdAt)} />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Roles</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {staff.roles.length ? (
                    staff.roles.map((r: Role) => (
                      <Badge key={r} className="bg-brand-50 text-brand-600 ring-brand-200">{ROLE_LABELS[r]}</Badge>
                    ))
                  ) : (
                    <Badge>Staff member</Badge>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Team" subtitle="Everyone whose requests reach this person" action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{team.length}</Badge>} />
            <div className="p-4">
              {team.length === 0 ? (
                <p className="text-xs text-slate-500">No direct or indirect reports.</p>
              ) : (
                <div className="space-y-1.5">
                  {team.map((t: any) => (
                    <Link
                      key={t.id}
                      to={`/staff/${t.id}`}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50"
                      style={{ paddingLeft: `${8 + (t.depth - 1) * 16}px` }}
                    >
                      <Users className="h-3 w-3 text-slate-300" />
                      <span className="font-medium text-ink">{t.name}</span>
                      <span className="text-[10.5px] text-slate-400">{t.jobTitle}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Departure check" subtitle="Blockers are enforced by the server" />
            <div className="p-4">
              {staff.leftAt ? (
                <p className="text-xs text-slate-500">This person has already left.</p>
              ) : blockers.length === 0 ? (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                  <DoorClosed className="h-3.5 w-3.5" /> No blockers — this person can be marked as left.
                </p>
              ) : (
                <ul className="space-y-2">
                  {blockers.map((b: any) => (
                    <li key={b.kind} className="flex gap-2 rounded-lg bg-red-50 p-2.5 text-[11px] text-red-700">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {b.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Assets held" subtitle="Issued items stay with the person when they leave" action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{assets.length}</Badge>} />
            {assets.length === 0 ? (
              <EmptyState icon={<Boxes className="h-5 w-5" />} title="No assets held" />
            ) : (
              <div className="divide-y divide-slate-50">
                {assets.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
                    <div>
                      <Link to={`/assets/${a.id}`} className="font-semibold text-brand-600 hover:underline">{a.ref}</Link>
                      <p className="text-[11px] text-slate-500">{a.assetTypeName}{a.serialNumber ? ` · ${a.serialNumber}` : ''}</p>
                    </div>
                    <AssetStatusBadge status={a.status} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Requests" subtitle="Raised by or for this person" />
            {requests.length === 0 ? (
              <EmptyState title="No requests" />
            ) : (
              <div className="table-scroll">
                <table className="w-full min-w-[520px] text-xs">
                  <thead>
                    <tr>
                      {['Request', 'Relation', 'Priority', 'Status', 'Raised'].map((h) => (
                        <th key={h} className="border-b border-slate-100 bg-slate-50/60 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r: any) => (
                      <tr key={`${r.id}-${r.relation}`}>
                        <td className="border-b border-slate-50 px-3 py-2">
                          <Link to={`/requests/${r.id}`} className="font-semibold text-brand-600 hover:underline">{r.ref}</Link>
                        </td>
                        <td className="border-b border-slate-50 px-3 py-2 text-slate-500">{r.relation === 'for' ? 'For them' : 'By them'}</td>
                        <td className="border-b border-slate-50 px-3 py-2"><PriorityBadge priority={r.priority} /></td>
                        <td className="border-b border-slate-50 px-3 py-2"><RequestStatusBadge status={r.status} /></td>
                        <td className="border-b border-slate-50 px-3 py-2 text-slate-500">{shortDate(r.raisedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit staff record"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={update.isPending}>Cancel</Button>
            <Button
              loading={update.isPending}
              onClick={() =>
                update.mutate({
                  name: form.name,
                  jobTitle: form.jobTitle || null,
                  managerId: form.managerId || null,
                  roles: form.roles,
                })
              }
            >
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Full name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Job title">
            <Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </Field>
          <Field label="Reports to" hint="Changing this restarts any review where this person is no longer above the requester.">
            <Select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
              <option value="">No manager</option>
              {managers.map((m: any) => (
                <option key={m.id} value={m.id}>{m.name} — {m.jobTitle ?? 'Staff'}</option>
              ))}
            </Select>
          </Field>
          <Field label="Roles">
            <div className="grid grid-cols-2 gap-2">
              {(['team_lead', 'line_manager', 'stock_manager', 'financial_executive', 'administrator'] as Role[]).map((r) => (
                <label key={r} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.roles.includes(r)}
                    onChange={(e) =>
                      setForm({ ...form, roles: e.target.checked ? [...form.roles, r] : form.roles.filter((x) => x !== r) })
                    }
                  />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </Modal>

      <Modal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Reset password"
        footer={
          <>
            <Button variant="outline" onClick={() => setPwOpen(false)} disabled={reset.isPending}>Cancel</Button>
            <Button loading={reset.isPending} onClick={() => reset.mutate({ password })}>Reset password</Button>
          </>
        }
      >
        <Field label="New password" required hint="At least 8 characters. The staff member is signed out everywhere.">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </Modal>

      <ConfirmDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onConfirm={() => leave.mutate()}
        title={`Mark ${staff.name} as left?`}
        message={
          <div className="space-y-2">
            <p>This cannot be undone from the interface. Their records and history are preserved.</p>
            <ul className="list-disc space-y-1 pl-4 text-[11px] text-slate-500">
              <li>Sign-in is disabled immediately and their sessions end.</li>
              <li>Outstanding requests are cancelled and open items closed as cancelled.</li>
              <li>Items already bought return to stock; already issued assets stay with them.</li>
            </ul>
            {blockers.length ? (
              <p className="text-red-600">There are blockers. Resolve them first — the server will refuse this otherwise.</p>
            ) : null}
          </div>
        }
        confirmLabel="Mark as left"
        tone="danger"
        loading={leave.isPending}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-[12.5px] text-ink">{value}</p>
    </div>
  );
}
