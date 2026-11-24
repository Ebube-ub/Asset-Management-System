import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Plus, Trash2, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Callout, Card, CardHeader, Field, Input, Select, Spinner, Textarea, useToast } from '../components/ui';
import { PRIORITY_LABELS } from '@shared/domain';

type Line = { assetTypeId: string; quantity: number; recipientRoomId: string };

export function NewRequestPage() {
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<any>('/meta') });

  const [raisedForId, setRaisedForId] = useState('');
  const [justification, setJustification] = useState('');
  const [priority, setPriority] = useState('medium');
  const [priorityJustification, setPriorityJustification] = useState('');
  const [businessImpact, setBusinessImpact] = useState('');
  const [lines, setLines] = useState<Line[]>([{ assetTypeId: '', quantity: 1, recipientRoomId: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isAdmin = hasRole('administrator');
  const needsPriorityDetail = priority === 'high' || priority === 'critical';

  const newHires = useMemo(
    () => (meta.data?.staff ?? []).filter((s: any) => !s.firstSignedInAt),
    [meta.data],
  );
  const typeById = useMemo(
    () => new Map<string, any>((meta.data?.assetTypes ?? []).map((t: any) => [t.id, t])),
    [meta.data],
  );

  const mutation = useMutation({
    mutationFn: (payload: any) => api<any>('/requests', { method: 'POST', body: payload }),
    onSuccess: (res) => {
      push('Request submitted and sent into the review chain.', 'success');
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/requests/${res.request.id}`);
    },
    onError: (err: Error) => push(err.message, 'error'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (justification.trim().length < 10) nextErrors.justification = 'Give a justification of at least 10 characters.';
    if (needsPriorityDetail && !priorityJustification.trim())
      nextErrors.priorityJustification = 'A priority justification is required for High and Critical.';
    if (needsPriorityDetail && !businessImpact.trim())
      nextErrors.businessImpact = 'The business impact is required for High and Critical.';
    if (lines.some((l) => !l.assetTypeId)) nextErrors.lines = 'Choose an asset type on every line.';
    if (lines.some((l) => l.quantity < 1)) nextErrors.lines = 'Quantity must be at least 1.';
    for (const line of lines) {
      const type = typeById.get(line.assetTypeId);
      if (type?.custodyKind === 'location' && !line.recipientRoomId) {
        nextErrors.lines = `${type.name} is held by location — choose a room.`;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    mutation.mutate({
      raisedForId: raisedForId || undefined,
      justification: justification.trim(),
      priority,
      priorityJustification: needsPriorityDetail ? priorityJustification.trim() : null,
      businessImpact: needsPriorityDetail ? businessImpact.trim() : null,
      lines: lines.map((l) => {
        const type = typeById.get(l.assetTypeId);
        return {
          assetTypeId: l.assetTypeId,
          quantity: Number(l.quantity),
          recipientRoomId: type?.custodyKind === 'location' ? l.recipientRoomId : null,
        };
      }),
    });
  };

  if (meta.isLoading) return <Spinner />;

  const selectedHire = newHires.find((s: any) => s.id === raisedForId);

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={() => navigate('/requests')} className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Back to requests
          </button>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Raise a request</h1>
          <p className="mt-1 text-sm text-slate-500">
            Requests climb the reporting lines one reviewer at a time; the first line manager sends it to the stock check.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/requests')}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>Submit request</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Who is this for?" subtitle="Items are always requested for a named person." />
            <div className="space-y-4 p-5">
              {isAdmin ? (
                <Field
                  label="Raise for a new hire"
                  hint="The administrator can raise a request for a staff member who has never signed in, so equipment is ready on day one."
                >
                  <Select value={raisedForId} onChange={(e) => setRaisedForId(e.target.value)}>
                    <option value="">Myself ({user?.name})</option>
                    {newHires.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {s.jobTitle ?? 'New hire'}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Raised for">
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-600">
                      {user?.name.split(' ').slice(0, 2).map((p) => p[0]).join('')}
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-ink">{user?.name}</p>
                      <p className="text-[11px] text-slate-500">Staff members can only raise requests for themselves.</p>
                    </div>
                  </div>
                </Field>
              )}

              {selectedHire ? (
                <Callout tone="info" title="Request raised on behalf of a new hire">
                  {selectedHire.name} has never signed in. The request is reviewed along their reporting chain
                  {selectedHire.managerId ? '' : ' — they currently have no manager, so review is skipped'} and the
                  items are assigned to them.
                </Callout>
              ) : null}

              {isAdmin && newHires.length === 0 ? (
                <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <UserPlus className="h-3 w-3" /> No new hires are waiting for their first sign-in.
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Requested items"
              subtitle="Choose one or more asset types. Each unit is tracked separately."
              action={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLines([...lines, { assetTypeId: '', quantity: 1, recipientRoomId: '' }])}
                  icon={<Plus className="h-3.5 w-3.5" />}
                >
                  Add line
                </Button>
              }
            />
            <div className="space-y-3 p-5">
              {lines.map((line, index) => {
                const type = typeById.get(line.assetTypeId);
                return (
                  <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                    <div className="grid gap-3 sm:grid-cols-[1.6fr_0.5fr_auto]">
                      <Field label={index === 0 ? 'Asset type' : undefined}>
                        <Select
                          value={line.assetTypeId}
                          onChange={(e) => {
                            const next = [...lines];
                            next[index] = { ...line, assetTypeId: e.target.value, recipientRoomId: '' };
                            setLines(next);
                          }}
                          required
                        >
                          <option value="">Select an asset type…</option>
                          {(meta.data?.assetTypes ?? []).map((t: any) => (
                            <option key={t.id} value={t.id}>
                              {t.name} · {t.custodyKind === 'person' ? 'held by person' : 'held by location'}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={index === 0 ? 'Quantity' : undefined}>
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          required
                          value={line.quantity}
                          onChange={(e) => {
                            const next = [...lines];
                            next[index] = { ...line, quantity: Number(e.target.value) };
                            setLines(next);
                          }}
                        />
                      </Field>
                      <div className="flex items-end">
                        {lines.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setLines(lines.filter((_, i) => i !== index))}
                            icon={<Trash2 className="h-4 w-4 text-red-500" />}
                            aria-label="Remove line"
                          />
                        ) : null}
                      </div>
                    </div>

                    {type?.custodyKind === 'location' ? (
                      <div className="mt-2.5">
                        <Field label="Room" required hint="This asset type is held by location, so it is placed in a room rather than assigned to a person.">
                          <Select
                            required
                            value={line.recipientRoomId}
                            onChange={(e) => {
                              const next = [...lines];
                              next[index] = { ...line, recipientRoomId: e.target.value };
                              setLines(next);
                            }}
                          >
                            <option value="">Select a room…</option>
                            {(meta.data?.rooms ?? []).map((r: any) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    ) : type ? (
                      <p className="mt-2 text-[11px] text-slate-400">
                        This asset type is held by a person and will be issued to {selectedHire?.name ?? user?.name}.
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {errors.lines ? <p className="text-xs font-medium text-red-600">{errors.lines}</p> : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Justification" subtitle="Required for every request, whether or not the item is in stock." />
            <div className="p-5">
              <Field error={errors.justification} required>
                <Textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Explain why these items are needed…"
                  maxLength={2000}
                  aria-invalid={!!errors.justification}
                />
              </Field>
              <p className="mt-1.5 text-right text-[11px] text-slate-400">{justification.length}/2000</p>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Priority" subtitle="Higher priorities come first in every queue." />
            <div className="space-y-4 p-5">
              <Field label="Priority" required>
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                      {k === 'medium' ? ' (default)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>

              {needsPriorityDetail ? (
                <>
                  <Callout tone="warning" title="High and Critical need more detail">
                    Explain why the priority is justified and what happens to the business if it slips.
                  </Callout>
                  <Field label="Priority justification" required error={errors.priorityJustification}>
                    <Textarea
                      value={priorityJustification}
                      onChange={(e) => setPriorityJustification(e.target.value)}
                      placeholder="Why does this need a higher priority?"
                      className="min-h-[70px]"
                      aria-invalid={!!errors.priorityJustification}
                    />
                  </Field>
                  <Field label="Business impact" required error={errors.businessImpact}>
                    <Textarea
                      value={businessImpact}
                      onChange={(e) => setBusinessImpact(e.target.value)}
                      placeholder="What is affected if this is delayed?"
                      className="min-h-[70px]"
                      aria-invalid={!!errors.businessImpact}
                    />
                  </Field>
                </>
              ) : (
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Low and Medium need no extra priority detail. A reviewer can still change the priority when passing the
                  request.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="What happens next" />
            <ol className="space-y-3 p-5 text-[11.5px] leading-relaxed text-slate-600">
              {[
                'The request starts with your direct manager and climbs the reporting lines one reviewer at a time.',
                'The first line manager passes it to the stock check, or rejects it — a rejected request is closed.',
                'The stock manager issues what is in stock; shortfalls go for vendor quotations and a financial decision.',
                'Everything is recorded in the request history, from this submission to the last handover.',
              ].map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-600">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Card>

          {mutation.isError ? (
            <Callout tone="danger" title="Could not submit">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" /> {(mutation.error as Error).message}
              </span>
            </Callout>
          ) : null}
        </div>
      </div>
    </form>
  );
}
