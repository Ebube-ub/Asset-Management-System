import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Info, Plus, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Callout, Card, CardHeader, Field, Input, Select, Spinner, Textarea, cn, useToast } from '../components/ui';
import { PRIORITY_HELP, PRIORITY_LABELS, type Priority } from '@shared/domain';

type Allocation = { staffId: string; quantity: number };
type Line = {
  assetTypeId: string;
  quantity: number;
  recipientRoomId: string;
  allocations: Allocation[];
};

const EMPTY_LINE: Line = { assetTypeId: '', quantity: 1, recipientRoomId: '', allocations: [] };

export function NewRequestPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = Boolean(id);
  const { user, hasRole } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<any>('/meta') });
  const existing = useQuery({
    queryKey: ['request', id],
    queryFn: () => api<any>(`/requests/${id}`),
    enabled: editing,
  });

  const [raisedForId, setRaisedForId] = useState('');
  const [showNewHire, setShowNewHire] = useState(false);
  const [groupMode, setGroupMode] = useState(false);
  const [justification, setJustification] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [priorityJustification, setPriorityJustification] = useState('');
  const [businessImpact, setBusinessImpact] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isAdmin = hasRole('administrator');
  const isLineManager = hasRole('line_manager');
  const needsPriorityDetail = priority === 'high' || priority === 'critical';

  // Prefill when the request came back for editing.
  useEffect(() => {
    if (!existing.data) return;
    const r = existing.data.request;
    setJustification(r.justification ?? '');
    setPriority((r.priority ?? 'medium') as Priority);
    setPriorityJustification(r.priorityJustification ?? '');
    setBusinessImpact(r.businessImpact ?? '');
    setGroupMode(!!r.isGroup);
    setLines(
      existing.data.lines.map((l: any) => ({
        assetTypeId: l.assetTypeId,
        quantity: l.quantity,
        recipientRoomId: l.recipientRoomId ?? '',
        allocations: (l.recipients ?? []).map((x: any) => ({ staffId: x.staffId, quantity: x.quantity })),
      })),
    );
  }, [existing.data]);

  const newHires = useMemo(
    () => (meta.data?.staff ?? []).filter((s: any) => !s.firstSignedInAt),
    [meta.data],
  );
  const typeById = useMemo(
    () => new Map<string, any>((meta.data?.assetTypes ?? []).map((t: any) => [t.id, t])),
    [meta.data],
  );

  // The line manager's team, at any depth in the reporting line.
  const team = useMemo(() => {
    const all: any[] = meta.data?.staff ?? [];
    const byManager = new Map<string, any[]>();
    for (const person of all) {
      if (!person.managerId) continue;
      byManager.set(person.managerId, [...(byManager.get(person.managerId) ?? []), person]);
    }
    const out: any[] = [];
    const seen = new Set<string>();
    const walk = (managerId: string) => {
      for (const person of byManager.get(managerId) ?? []) {
        if (seen.has(person.id)) continue;
        seen.add(person.id);
        out.push(person);
        walk(person.id);
      }
    };
    if (user) walk(user.id);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [meta.data, user]);

  const mutation = useMutation({
    mutationFn: async ({ resubmit }: { resubmit: boolean }) => {
      const payload = {
        raisedForId: raisedForId || undefined,
        justification: justification.trim(),
        priority,
        priorityJustification: needsPriorityDetail ? priorityJustification.trim() : null,
        businessImpact: needsPriorityDetail ? businessImpact.trim() : null,
        lines: lines.map((l) => {
          const type = typeById.get(l.assetTypeId);
          const allocations = groupMode && type?.custodyKind === 'person' ? l.allocations.filter((a) => a.quantity > 0) : [];
          return {
            assetTypeId: l.assetTypeId,
            quantity: allocations.length ? allocations.reduce((s, a) => s + a.quantity, 0) : Number(l.quantity),
            recipientRoomId: type?.custodyKind === 'location' ? l.recipientRoomId : null,
            recipients: allocations.length ? allocations : null,
          };
        }),
      };
      if (editing) {
        await api(`/requests/${id}`, { method: 'PATCH', body: payload });
        if (resubmit) await api(`/requests/${id}/resubmit`, { method: 'POST', body: {} });
        return { resubmitted: resubmit, requestId: String(id) };
      }
      const created = await api<any>('/requests', { method: 'POST', body: payload });
      return { resubmitted: false, requestId: created.request.id };
    },
    onSuccess: ({ resubmitted, requestId }) => {
      push(
        resubmitted
          ? 'Request updated and resubmitted for review.'
          : editing
            ? 'Changes saved. Resubmit when you are ready for it to continue.'
            : 'Request submitted. Your reviewer has been notified.',
        'success',
      );
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['request', requestId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/requests/${requestId}`);
    },
    onError: (err: Error) => push(err.message, 'error'),
  });

  const runSubmit = (resubmit: boolean) => {
    const nextErrors: Record<string, string> = {};
    if (justification.trim().length < 10) nextErrors.justification = 'Explain what you need and why (at least 10 characters).';
    if (needsPriorityDetail && !priorityJustification.trim())
      nextErrors.priorityJustification = 'Explain why this needs a higher priority.';
    if (needsPriorityDetail && !businessImpact.trim())
      nextErrors.businessImpact = 'Describe what is affected if this is delayed.';
    if (lines.some((l) => !l.assetTypeId)) nextErrors.lines = 'Choose an item on every line.';
    if (!groupMode && lines.some((l) => Number(l.quantity) < 1)) nextErrors.lines = 'Quantity must be at least 1.';
    for (const line of lines) {
      const type = typeById.get(line.assetTypeId);
      if (type?.custodyKind === 'location' && !line.recipientRoomId) {
        nextErrors.lines = `${type.name} is held by a location — choose a room.`;
      }
      if (groupMode && type?.custodyKind === 'person') {
        const total = line.allocations.reduce((s, a) => s + Number(a.quantity || 0), 0);
        if (total < 1) nextErrors.lines = `Choose at least one person for ${type.name}.`;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    mutation.mutate({ resubmit });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSubmit(!editing);
  };

  if (meta.isLoading || (editing && existing.isLoading)) return <Spinner label="Preparing the request form…" />;
  if (editing && existing.isError)
    return <Callout tone="danger" title="Could not load this request">{(existing.error as Error).message}</Callout>;

  const selectedHire = newHires.find((s: any) => s.id === raisedForId);

  const updateLine = (index: number, patch: Partial<Line>) => {
    const next = [...lines];
    next[index] = { ...next[index], ...patch };
    setLines(next);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate(editing ? `/requests/${id}` : '/requests')}
            className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-brand-600"
          >
            <ArrowLeft className="h-3 w-3" /> {editing ? 'Back to the request' : 'Back to requests'}
          </button>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">{editing ? 'Edit your request' : 'New request'}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {editing
              ? 'Make the changes your reviewer asked for, then resubmit. It picks up from the review stage it was returned from.'
              : 'Tell us what you need and why. The request goes to your reviewer first, then to the stock check.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(editing ? `/requests/${id}` : '/requests')}>
            Cancel
          </Button>
          {editing ? (
            <>
              <Button type="button" variant="outline" loading={mutation.isPending} onClick={() => runSubmit(false)}>
                Save changes
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                Save and resubmit
              </Button>
            </>
          ) : (
            <Button type="submit" loading={mutation.isPending}>
              Submit request
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-4">
          {editing && existing.data?.request?.returnReason ? (
            <Callout tone="warning" title="Why this was returned">
              {existing.data.request.returnReason}
              <p className="mt-1 text-[11px] opacity-80">
                Returned by {existing.data.request.returnedByName ?? 'your reviewer'}. Fix what is needed, then resubmit.
              </p>
            </Callout>
          ) : null}

          <Card>
            <CardHeader
              title="What do you need?"
              subtitle="Each unit is tracked as its own asset, so stock and the register stay accurate."
              action={
                !editing && isLineManager ? (
                  <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-600">
                    <input type="checkbox" checked={groupMode} onChange={(e) => setGroupMode(e.target.checked)} />
                    <Users className="h-3.5 w-3.5" /> Group request
                  </label>
                ) : null
              }
            />
            <div className="space-y-3 p-5">
              {groupMode ? (
                <Callout tone="info" title="One request, several people">
                  Allocate each unit to a member of your team. The request is reviewed once, and every person still gets
                  their own asset record and handover.
                </Callout>
              ) : null}

              {lines.map((line, index) => {
                const type = typeById.get(line.assetTypeId);
                const isLocation = type?.custodyKind === 'location';
                const allocated = line.allocations.reduce((s, a) => s + Number(a.quantity || 0), 0);
                return (
                  <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                    <div className={cn('grid gap-3', groupMode && !isLocation ? 'sm:grid-cols-[1fr_auto]' : 'sm:grid-cols-[1.6fr_0.5fr_auto]')}>
                      <Field label={index === 0 ? 'Item' : undefined}>
                        <Select
                          value={line.assetTypeId}
                          onChange={(e) => updateLine(index, { assetTypeId: e.target.value, recipientRoomId: '', allocations: [] })}
                          required
                        >
                          <option value="">Choose an item…</option>
                          {(meta.data?.assetTypes ?? []).map((t: any) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {t.minRequestRole ? ` · ${t.minRequestRole.replace('_', ' ')} and above` : ''}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {!groupMode ? (
                        <Field label={index === 0 ? 'Quantity' : undefined}>
                          <Input
                            type="number"
                            min={1}
                            max={50}
                            required
                            value={line.quantity}
                            onChange={(e) => updateLine(index, { quantity: Number(e.target.value) })}
                          />
                        </Field>
                      ) : (
                        <div className="flex items-end pb-2 text-[11px] text-slate-500">
                          {type && !isLocation ? `${allocated} unit(s) allocated` : null}
                        </div>
                      )}
                      <div className="flex items-end">
                        {lines.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setLines(lines.filter((_, i) => i !== index))}
                            icon={<Trash2 className="h-4 w-4 text-red-500" />}
                            aria-label="Remove this line"
                          />
                        ) : null}
                      </div>
                    </div>

                    {isLocation ? (
                      <div className="mt-2.5">
                        <Field label="Room" required hint="This item belongs to a location rather than a person.">
                          <Select
                            required
                            value={line.recipientRoomId}
                            onChange={(e) => updateLine(index, { recipientRoomId: e.target.value })}
                          >
                            <option value="">Choose a room…</option>
                            {(meta.data?.rooms ?? []).map((r: any) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    ) : groupMode && type ? (
                      <div className="mt-3">
                        <p className="mb-1.5 text-xs font-semibold text-slate-600">Who is each unit for?</p>
                        {team.length === 0 ? (
                          <p className="text-[11px] text-slate-500">Nobody reports to you yet, so there is no team to allocate to.</p>
                        ) : (
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {team.map((person) => {
                              const allocation = line.allocations.find((a) => a.staffId === person.id);
                              return (
                                <label
                                  key={person.id}
                                  className={cn(
                                    'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px]',
                                    allocation ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-surface',
                                  )}
                                >
                                  <span className="min-w-0 truncate text-slate-700">{person.name}</span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={50}
                                    value={allocation?.quantity ?? 0}
                                    onChange={(e) => {
                                      const quantity = Math.max(0, Math.min(50, Number(e.target.value) || 0));
                                      const others = line.allocations.filter((a) => a.staffId !== person.id);
                                      updateLine(index, {
                                        allocations: [...others, { staffId: person.id, quantity }].filter((a) => a.quantity > 0),
                                      });
                                    }}
                                    className="w-14 rounded-md border border-slate-200 bg-surface px-1.5 py-1 text-right text-[11px] text-ink"
                                    aria-label={`Quantity for ${person.name}`}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : type ? (
                      <p className="mt-2 text-[11px] text-slate-400">
                        This item is assigned to {selectedHire?.name ?? user?.name} once it is handed over.
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {errors.lines ? <p className="text-xs font-medium text-red-600">{errors.lines}</p> : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setLines([...lines, { ...EMPTY_LINE }])}
                icon={<Plus className="h-3.5 w-3.5" />}
              >
                Add another item
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Why do you need it?" subtitle="A short, plain explanation is enough — this is what the reviewer reads." />
            <div className="p-5">
              <Field error={errors.justification} required>
                <Textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="For example: my laptop battery no longer holds charge, so I cannot work away from my desk."
                  maxLength={2000}
                  aria-invalid={!!errors.justification}
                />
              </Field>
              <div className="mt-1.5 flex items-center justify-between">
                <p className="text-[11px] text-slate-400">Mention what is wrong, or what the item is for.</p>
                <p className="text-[11px] text-slate-400">{justification.length}/2000</p>
              </div>
            </div>
          </Card>

          {isAdmin && !editing ? (
            <Card>
              <CardHeader
                title="Requesting for a new hire"
                subtitle="Administrators can prepare equipment for someone who has never signed in."
                action={
                  <label className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
                    <input type="checkbox" checked={showNewHire} onChange={(e) => setShowNewHire(e.target.checked)} />
                    Raise on their behalf
                  </label>
                }
              />
              {showNewHire ? (
                <div className="space-y-3 p-5">
                  <Field label="New hire" hint="Only people who have never signed in are listed.">
                    <Select value={raisedForId} onChange={(e) => setRaisedForId(e.target.value)}>
                      <option value="">Myself ({user?.name})</option>
                      {newHires.map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.name} — {s.jobTitle ?? 'New hire'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {selectedHire ? (
                    <Callout tone="info" title="Request raised for a new hire">
                      {selectedHire.name} has never signed in. The request follows their reporting line and the items are
                      assigned to them.
                    </Callout>
                  ) : null}
                  {newHires.length === 0 ? (
                    <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Info className="h-3 w-3" /> No new hires are waiting for their first sign-in.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="How urgent is it?" subtitle="Medium is the normal, planned need and is chosen by default." />
            <div className="space-y-2 p-5">
              {(['critical', 'high', 'medium', 'low'] as Priority[]).map((p) => (
                <label
                  key={p}
                  className={cn(
                    'block cursor-pointer rounded-xl border p-3 transition-colors',
                    priority === p ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 hover:border-brand-200',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} />
                    <span className="text-[13px] font-semibold text-ink">{PRIORITY_LABELS[p]}</span>
                    {p === 'medium' ? (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                        Default
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block pl-6 text-[11px] leading-relaxed text-slate-500">
                    {PRIORITY_HELP[p].summary}
                  </span>
                  {priority === p ? (
                    <span className="mt-1.5 block pl-6 text-[11px] leading-relaxed text-slate-600">
                      <strong className="font-semibold text-slate-700">Use it when:</strong> {PRIORITY_HELP[p].when}
                    </span>
                  ) : null}
                </label>
              ))}

              {needsPriorityDetail ? (
                <div className="space-y-3 pt-1">
                  <Callout tone="warning" title="High and Critical need a little more detail">
                    Explain why the priority is justified and what happens if it slips. Reviewers can see both.
                  </Callout>
                  <Field label="Why this priority?" required error={errors.priorityJustification}>
                    <Textarea
                      value={priorityJustification}
                      onChange={(e) => setPriorityJustification(e.target.value)}
                      placeholder="For example: the whole team is blocked until this is replaced."
                      className="min-h-[70px]"
                      aria-invalid={!!errors.priorityJustification}
                    />
                  </Field>
                  <Field label="What is the business impact?" required error={errors.businessImpact}>
                    <Textarea
                      value={businessImpact}
                      onChange={(e) => setBusinessImpact(e.target.value)}
                      placeholder="For example: client delivery slips past Friday and two people cannot work."
                      className="min-h-[70px]"
                      aria-invalid={!!errors.businessImpact}
                    />
                  </Field>
                </div>
              ) : (
                <p className="pt-1 text-[11px] leading-relaxed text-slate-400">
                  Low and Medium need no extra detail. A reviewer who raises the priority later must add the justification
                  themselves.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="What happens next" />
            <ol className="space-y-3 p-5 text-[11.5px] leading-relaxed text-slate-600">
              {[
                'Your request goes to your reviewer — a team lead or line manager in your reporting line.',
                'They can approve it, return it to you for changes, or reject it. A returned request is not closed.',
                'If your asset category needs a senior sign-off, that approval happens before stock is checked.',
                'The stock manager issues what is available; anything else goes for quotations and a financial decision.',
                'Issued items are handed over or collected, and every step stays in the request history.',
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

          <Callout tone="info" title="Your data">
            This request is raised for you. Staff members can only request assets for themselves; a line manager can raise
            a group request for their own team, and an administrator can prepare equipment for a new hire.
          </Callout>
        </div>
      </div>
    </form>
  );
}
