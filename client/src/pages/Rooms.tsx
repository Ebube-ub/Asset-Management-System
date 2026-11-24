import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, Plus } from 'lucide-react';
import { api } from '../lib/api';
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
  Spinner,
  Table,
  Td,
  Th,
  useToast,
} from '../components/ui';

export function RoomsPage() {
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['rooms'], queryFn: () => api<any>('/rooms') });
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', building: '', floor: '', active: true });

  const save = useMutation({
    mutationFn: (payload: any) =>
      edit
        ? api<any>(`/rooms/${edit.id}`, { method: 'PATCH', body: payload })
        : api<any>('/rooms', { method: 'POST', body: payload }),
    onSuccess: () => {
      push(edit ? 'Room updated.' : 'Room added.', 'success');
      setOpen(false);
      setEdit(null);
      setForm({ name: '', building: '', floor: '', active: true });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
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
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Rooms</h1>
          <p className="mt-1 text-sm text-slate-500">
            Rooms are the destination for assets held by location — projectors, air conditioners and similar equipment.
          </p>
        </div>
        <Button
          onClick={() => {
            setEdit(null);
            setForm({ name: '', building: '', floor: '', active: true });
            setOpen(true);
          }}
          icon={<Plus className="h-4 w-4" />}
        >
          Add room
        </Button>
      </div>

      <Card>
        {query.data.rows.length === 0 ? (
          <EmptyState icon={<DoorOpen className="h-6 w-6" />} title="No rooms yet" message="Add the rooms of your office to place location-held assets." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Room</Th>
                <Th>Building</Th>
                <Th>Floor</Th>
                <Th>Assets held</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((r: any) => (
                <tr key={r.id}>
                  <Td><p className="text-xs font-semibold text-ink">{r.name}</p></Td>
                  <Td className="text-xs text-slate-600">{r.building ?? '—'}</Td>
                  <Td className="text-xs text-slate-600">{r.floor ?? '—'}</Td>
                  <Td className="text-xs text-slate-600">{r.assetCount}</Td>
                  <Td>
                    <Badge className={r.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}>
                      {r.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEdit(r);
                        setForm({ name: r.name, building: r.building ?? '', floor: r.floor ?? '', active: r.active });
                        setOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={edit ? 'Edit room' : 'Add a room'}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(form)}>{edit ? 'Save changes' : 'Add room'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Room name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Boardroom" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Building">
              <Input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} />
            </Field>
            <Field label="Floor">
              <Input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} />
            </Field>
          </div>
          {edit ? (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active (available when choosing a room on a request)
            </label>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
