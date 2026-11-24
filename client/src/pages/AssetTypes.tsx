import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Tags } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Badge,
  Button,
  Card,
  CardHeader,
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
  Textarea,
  useToast,
} from '../components/ui';

export function AssetTypesPage() {
  const { hasRole } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['asset-types'], queryFn: () => api<any>('/asset-types?includeInactive=true') });
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', custodyKind: 'person', category: '', description: '', active: true });

  const isAdmin = hasRole('administrator');

  const save = useMutation({
    mutationFn: (payload: any) =>
      edit
        ? api<any>(`/asset-types/${edit.id}`, { method: 'PATCH', body: payload })
        : api<any>('/asset-types', { method: 'POST', body: payload }),
    onSuccess: () => {
      push(edit ? 'Asset type updated.' : 'Asset type added.', 'success');
      setOpen(false);
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['asset-types'] });
      void qc.invalidateQueries({ queryKey: ['meta'] });
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Asset Types</h1>
          <p className="mt-1 text-sm text-slate-500">
            A catalogue entry is not an individual asset. The type also decides whether its items are held by a person or a
            location.
          </p>
        </div>
        {isAdmin ? (
          <Button
            onClick={() => {
              setEdit(null);
              setForm({ name: '', custodyKind: 'person', category: '', description: '', active: true });
              setOpen(true);
            }}
            icon={<Plus className="h-4 w-4" />}
          >
            Add asset type
          </Button>
        ) : null}
      </div>

      <Card>
        {query.data.rows.length === 0 ? (
          <EmptyState icon={<Tags className="h-6 w-6" />} title="No asset types yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Asset type</Th>
                <Th>Category</Th>
                <Th>Custody</Th>
                <Th>Available</Th>
                <Th>Assigned</Th>
                <Th>Total</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((t: any) => (
                <tr key={t.id}>
                  <Td>
                    <p className="text-xs font-semibold text-ink">{t.name}</p>
                    {t.description ? <p className="text-[11px] text-slate-400">{t.description}</p> : null}
                  </Td>
                  <Td className="text-xs text-slate-600">{t.category}</Td>
                  <Td>
                    <Badge className={t.custodyKind === 'person' ? 'bg-brand-50 text-brand-600 ring-brand-200' : 'bg-violet-50 text-violet-700 ring-violet-200'}>
                      {t.custodyKind === 'person' ? 'Person' : 'Location'}
                    </Badge>
                  </Td>
                  <Td className="text-xs font-medium text-emerald-600">{t.availableCount}</Td>
                  <Td className="text-xs font-medium text-brand-600">{t.assignedCount}</Td>
                  <Td className="text-xs text-slate-600">{t.totalCount}</Td>
                  <Td>
                    <Badge className={t.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}>
                      {t.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </Td>
                  <Td>
                    {isAdmin ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEdit(t);
                          setForm({
                            name: t.name,
                            custodyKind: t.custodyKind,
                            category: t.category ?? '',
                            description: t.description ?? '',
                            active: t.active,
                          });
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="p-4">
        <p className="text-[11px] leading-relaxed text-slate-500">
          Person custody: items are issued to a named staff member (laptops, phones, chairs). Location custody: items are
          placed in a room (air conditioners, projectors, network switches). Approval and purchase rules are identical for
          both.
        </p>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={edit ? 'Edit asset type' : 'Add an asset type'}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(form)}>{edit ? 'Save changes' : 'Add asset type'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dell Latitude 7440 Laptop" />
          </Field>
          <Field label="Category">
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. IT Equipment" />
          </Field>
          <Field label="Custody" required hint="Changing this affects new assignments only, never history.">
            <Select value={form.custodyKind} onChange={(e) => setForm({ ...form, custodyKind: e.target.value })}>
              <option value="person">Person — assigned to a staff member</option>
              <option value="location">Location — placed in a room</option>
            </Select>
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[70px]" />
          </Field>
          {edit ? (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active (offered when raising a request)
            </label>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
