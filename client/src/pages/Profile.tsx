import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Save, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Spinner,
  Table,
  Td,
  Th,
  useToast,
} from '../components/ui';
import { AssetStatusBadge, PriorityBadge, RequestStatusBadge } from '../components/badges';
import { ROLE_LABELS, type Role } from '@shared/domain';
import { shortDate } from '../lib/format';

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['profile'], queryFn: () => api<any>('/profile') });
  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });

  useEffect(() => {
    if (query.data?.staff) {
      setName(query.data.staff.name);
      setJobTitle(query.data.staff.jobTitle ?? '');
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: (payload: any) => api<any>('/profile', { method: 'PATCH', body: payload }),
    onSuccess: async () => {
      push('Profile updated.', 'success');
      await refresh();
      void qc.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const changePassword = useMutation({
    mutationFn: (payload: any) => api<any>('/profile/password', { method: 'POST', body: payload }),
    onSuccess: () => {
      push('Password changed.', 'success');
      setPasswords({ currentPassword: '', newPassword: '' });
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  const { staff, requests, assets } = query.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={user?.name ?? ''} size="lg" />
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">{user?.name}</h1>
          <p className="text-sm text-slate-500">{staff?.jobTitle ?? 'Staff member'} · {user?.email}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {user?.roles.length ? (
              user.roles.map((r: Role) => (
                <Badge key={r} className="bg-brand-50 text-brand-600 ring-brand-200">{ROLE_LABELS[r]}</Badge>
              ))
            ) : (
              <Badge>Staff member</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your details" action={<UserRound className="h-4 w-4 text-slate-400" />} />
          <div className="space-y-3 p-5">
            <Field label="Full name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Job title">
              <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Reports to</p>
                <p className="mt-0.5 text-ink">{staff?.managerName ?? 'No manager'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">First signed in</p>
                <p className="mt-0.5 text-ink">{staff?.firstSignedInAt ? shortDate(staff.firstSignedInAt) : 'Today'}</p>
              </div>
            </div>
            <Button loading={save.isPending} onClick={() => save.mutate({ name, jobTitle: jobTitle || null })} icon={<Save className="h-4 w-4" />}>
              Save details
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Change password" action={<KeyRound className="h-4 w-4 text-slate-400" />} />
          <div className="space-y-3 p-5">
            <Field label="Current password" required>
              <Input type="password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} />
            </Field>
            <Field label="New password" required hint="At least 8 characters.">
              <Input type="password" value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} />
            </Field>
            <Button variant="outline" loading={changePassword.isPending} onClick={() => changePassword.mutate(passwords)}>
              Change password
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="My requests" subtitle="Raised by or for you" action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{requests.length}</Badge>} />
        {requests.length === 0 ? (
          <EmptyState title="You have not raised any requests" message="Use New request to ask for equipment." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Request</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
                <Th>Raised</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r: any) => (
                <tr key={r.id}>
                  <Td><Link to={`/requests/${r.id}`} className="text-xs font-semibold text-brand-600 hover:underline">{r.ref}</Link></Td>
                  <Td><PriorityBadge priority={r.priority} /></Td>
                  <Td><RequestStatusBadge status={r.status} /></Td>
                  <Td className="text-[11px] text-slate-500">{shortDate(r.raisedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="My assets" subtitle="Items currently held in your name" action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{assets.length}</Badge>} />
        {assets.length === 0 ? (
          <EmptyState title="No assets assigned to you" message="Assets appear here when a request is issued to you." />
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
    </div>
  );
}
