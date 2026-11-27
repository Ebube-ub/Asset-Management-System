import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Layers, Plus, ShieldCheck, Tags, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '../components/ui';
import { ROLE_LABELS, type Role } from '@shared/domain';

type FieldDraft = {
  key: string;
  label: string;
  fieldType: 'text' | 'number' | 'select' | 'date' | 'checkbox';
  options: string;
  required: boolean;
};

type TypeDraft = {
  id?: string;
  name: string;
  custodyKind: 'person' | 'location';
  categoryId: string;
  description: string;
  attributes: FieldDraft[];
};

const EMPTY_FIELD: FieldDraft = { key: '', label: '', fieldType: 'text', options: '', required: false };

const EMPTY_TYPE: TypeDraft = {
  name: '',
  custodyKind: 'person',
  categoryId: '',
  description: '',
  attributes: [],
};

export function AssetConfigurationPage() {
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['asset-configuration'], queryFn: () => api<any>('/asset-configuration') });

  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryEdit, setCategoryEdit] = useState<any | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
    approvalRole: '',
    minRequestRole: '',
    active: true,
  });

  const [typeOpen, setTypeOpen] = useState(false);
  const [typeDraft, setTypeDraft] = useState<TypeDraft>({ ...EMPTY_TYPE });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['asset-configuration'] });
    void qc.invalidateQueries({ queryKey: ['meta'] });
    void qc.invalidateQueries({ queryKey: ['asset-types'] });
  };

  const saveCategory = useMutation({
    mutationFn: (payload: any) =>
      categoryEdit
        ? api(`/asset-categories/${categoryEdit.id}`, { method: 'PATCH', body: payload })
        : api('/asset-categories', { method: 'POST', body: payload }),
    onSuccess: () => {
      push(categoryEdit ? 'Category updated.' : 'Category created.', 'success');
      setCategoryOpen(false);
      setCategoryEdit(null);
      refresh();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const saveType = useMutation({
    mutationFn: (payload: any) =>
      typeDraft.id
        ? api(`/asset-types/${typeDraft.id}`, { method: 'PATCH', body: payload })
        : api('/asset-types', { method: 'POST', body: payload }),
    onSuccess: () => {
      push(typeDraft.id ? 'Asset type updated.' : 'Asset type created.', 'success');
      setTypeOpen(false);
      refresh();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const categories = query.data?.categories ?? [];
  const types = query.data?.types ?? [];
  const roleOptions = useMemo(() => Object.entries(ROLE_LABELS) as [Role, string][], []);

  if (query.isLoading) return <Spinner label="Loading asset configuration…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;

  const openCategory = (category: any | null) => {
    setCategoryEdit(category);
    setCategoryForm({
      name: category?.name ?? '',
      description: category?.description ?? '',
      approvalRole: category?.approvalRole ?? '',
      minRequestRole: category?.minRequestRole ?? '',
      active: category?.active ?? true,
    });
    setCategoryOpen(true);
  };

  const openType = (type: any | null) => {
    setTypeDraft(
      type
        ? {
            id: type.id,
            name: type.name,
            custodyKind: type.custodyKind,
            categoryId: type.categoryId ?? '',
            description: type.description ?? '',
            attributes: (type.attributes ?? [])
              .filter((a: any) => a.active)
              .map((a: any) => ({
                key: a.key,
                label: a.label,
                fieldType: a.fieldType,
                options: (a.options ?? []).join(', '),
                required: a.required,
              })),
          }
        : { ...EMPTY_TYPE, categoryId: categories[0]?.id ?? '' },
    );
    setTypeOpen(true);
  };

  const submitType = () => {
    saveType.mutate({
      name: typeDraft.name,
      custodyKind: typeDraft.custodyKind,
      categoryId: typeDraft.categoryId || null,
      description: typeDraft.description || null,
      attributes: typeDraft.attributes.map((f, index) => ({
        key: f.key.trim(),
        label: f.label.trim(),
        fieldType: f.fieldType,
        options:
          f.fieldType === 'select'
            ? f.options
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
            : [],
        required: f.required,
        position: index,
      })),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Asset Configuration</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Categories, the asset types inside them, the fields each type captures, and the approval level a category
            needs before stock is checked.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openCategory(null)} icon={<Layers className="h-4 w-4" />}>
            New category
          </Button>
          <Button onClick={() => openType(null)} icon={<Plus className="h-4 w-4" />}>
            New asset type
          </Button>
        </div>
      </div>

      <Callout tone="info" title="How approval works">
        The reporting line always reviews a request first. A category can then require one more approval level — for
        example facilities equipment needing a line manager or administrator sign-off. A category can also be limited to a
        minimum role, and the server refuses requests from anyone below that level even if they call the API directly.
      </Callout>

      <Card>
        <CardHeader
          title="Asset categories"
          subtitle="Each category sets the approval level and who may request its items"
          action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{categories.length}</Badge>}
        />
        {categories.length === 0 ? (
          <EmptyState icon={<Layers className="h-6 w-6" />} title="No categories yet" message="Create a category before adding asset types." />
        ) : (
          <div className="divide-y divide-slate-50">
            {categories.map((c: any) => (
              <div key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-semibold text-ink">{c.name}</p>
                    {!c.active ? (
                      <Badge className="bg-slate-100 text-slate-500 ring-slate-200">Inactive</Badge>
                    ) : null}
                    {c.approvalRole ? (
                      <Badge className="bg-violet-50 text-violet-700 ring-violet-200">
                        <ShieldCheck className="h-3 w-3" /> {ROLE_LABELS[c.approvalRole as Role]} approval
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-600 ring-slate-200">No extra approval</Badge>
                    )}
                    {c.minRequestRole ? (
                      <Badge className="bg-amber-50 text-amber-700 ring-amber-200">
                        {ROLE_LABELS[c.minRequestRole as Role]} and above only
                      </Badge>
                    ) : null}
                  </div>
                  {c.description ? <p className="mt-1 max-w-xl text-[11.5px] text-slate-500">{c.description}</p> : null}
                  <p className="mt-1 text-[11px] text-slate-400">
                    {c.typeCount} asset type(s) · {c.assetCount} registered asset(s)
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => openCategory(c)}>
                  Edit
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Asset types and their fields"
          subtitle="Only the fields for the chosen type are shown when an asset is registered or purchased"
          action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{types.length}</Badge>}
        />
        {types.length === 0 ? (
          <EmptyState icon={<Tags className="h-6 w-6" />} title="No asset types yet" />
        ) : (
          <div className="divide-y divide-slate-50">
            {types.map((t: any) => (
              <div key={t.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold text-ink">{t.name}</p>
                      <Badge className="bg-brand-50 text-brand-600 ring-brand-200">{t.categoryName ?? t.category}</Badge>
                      <Badge className="bg-slate-100 text-slate-600 ring-slate-200">
                        {t.custodyKind === 'person' ? 'Held by a person' : 'Held by a location'}
                      </Badge>
                      {t.approvalRole ? (
                        <Badge className="bg-violet-50 text-violet-700 ring-violet-200">
                          {ROLE_LABELS[t.approvalRole as Role]} approval
                        </Badge>
                      ) : null}
                      {!t.active ? <Badge className="bg-slate-100 text-slate-500 ring-slate-200">Inactive</Badge> : null}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {t.totalCount} registered · {t.availableCount} available · {t.assignedCount} assigned ·{' '}
                      {t.attributeCount} field(s)
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => openType(t)}>
                    Edit type & fields
                  </Button>
                </div>
                {t.attributes.filter((a: any) => a.active).length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.attributes
                      .filter((a: any) => a.active)
                      .map((a: any) => (
                        <span
                          key={a.id}
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10.5px] ring-1 ring-inset',
                            a.required
                              ? 'bg-brand-50 text-brand-700 ring-brand-200'
                              : 'bg-slate-100 text-slate-600 ring-slate-200',
                          )}
                        >
                          {a.label}
                          {a.required ? ' *' : ''}
                        </span>
                      ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-slate-400">No extra fields — this type captures serial, condition and notes only.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Category modal */}
      <Modal
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        title={categoryEdit ? 'Edit category' : 'New asset category'}
        description="Approval and request limits apply to every asset type in this category."
        footer={
          <>
            <Button variant="outline" onClick={() => setCategoryOpen(false)} disabled={saveCategory.isPending}>
              Cancel
            </Button>
            <Button
              loading={saveCategory.isPending}
              onClick={() =>
                saveCategory.mutate({
                  name: categoryForm.name,
                  description: categoryForm.description || null,
                  approvalRole: categoryForm.approvalRole || null,
                  minRequestRole: categoryForm.minRequestRole || null,
                  active: categoryForm.active,
                })
              }
            >
              {categoryEdit ? 'Save category' : 'Create category'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Category name" required>
            <Input
              value={categoryForm.name}
              onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
              placeholder="e.g. IT Equipment"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={categoryForm.description}
              onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
              className="min-h-[70px]"
            />
          </Field>
          <Field
            label="Extra approval level"
            hint="After the reporting-line review, a holder of this role must approve before stock is checked."
          >
            <Select
              value={categoryForm.approvalRole}
              onChange={(e) => setCategoryForm({ ...categoryForm, approvalRole: e.target.value })}
            >
              <option value="">No extra approval</option>
              {roleOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Who may request this category?"
            hint="Leave empty for everyone. Otherwise the server rejects requests from anyone below this level."
          >
            <Select
              value={categoryForm.minRequestRole}
              onChange={(e) => setCategoryForm({ ...categoryForm, minRequestRole: e.target.value })}
            >
              <option value="">Everyone</option>
              {roleOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label} and above
                </option>
              ))}
            </Select>
          </Field>
          {categoryEdit ? (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={categoryForm.active}
                onChange={(e) => setCategoryForm({ ...categoryForm, active: e.target.checked })}
              />
              Active (offered when raising a request)
            </label>
          ) : null}
        </div>
      </Modal>

      {/* Asset type modal */}
      <Modal
        open={typeOpen}
        onClose={() => setTypeOpen(false)}
        title={typeDraft.id ? 'Edit asset type' : 'New asset type'}
        description="The fields here are the only ones shown for this type when an asset is registered."
        width="max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setTypeOpen(false)} disabled={saveType.isPending}>
              Cancel
            </Button>
            <Button loading={saveType.isPending} onClick={submitType}>
              {typeDraft.id ? 'Save asset type' : 'Create asset type'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            <Input
              value={typeDraft.name}
              onChange={(e) => setTypeDraft({ ...typeDraft, name: e.target.value })}
              placeholder="e.g. Office Chair"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" required>
              <Select
                value={typeDraft.categoryId}
                onChange={(e) => setTypeDraft({ ...typeDraft, categoryId: e.target.value })}
              >
                <option value="">No category</option>
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Custody" required hint="Changing this affects new assignments only, never history.">
              <Select
                value={typeDraft.custodyKind}
                onChange={(e) => setTypeDraft({ ...typeDraft, custodyKind: e.target.value as 'person' | 'location' })}
              >
                <option value="person">Held by a person</option>
                <option value="location">Held by a location</option>
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Input
              value={typeDraft.description}
              onChange={(e) => setTypeDraft({ ...typeDraft, description: e.target.value })}
              placeholder="Optional"
            />
          </Field>

          <div className="rounded-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <p className="text-xs font-semibold text-slate-600">Fields for this asset type</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTypeDraft({ ...typeDraft, attributes: [...typeDraft.attributes, { ...EMPTY_FIELD }] })}
                icon={<Plus className="h-3.5 w-3.5" />}
              >
                Add field
              </Button>
            </div>
            {typeDraft.attributes.length === 0 ? (
              <p className="px-3 py-4 text-[11px] text-slate-400">
                No extra fields. Serial number, condition and notes are always captured.
              </p>
            ) : (
              <div className="space-y-2 p-3">
                {typeDraft.attributes.map((field, index) => (
                  <div key={index} className="rounded-lg bg-slate-50/70 p-2.5">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="Label" required>
                        <Input
                          value={field.label}
                          onChange={(e) => {
                            const next = [...typeDraft.attributes];
                            next[index] = { ...field, label: e.target.value };
                            setTypeDraft({ ...typeDraft, attributes: next });
                          }}
                          placeholder="e.g. Serial number"
                        />
                      </Field>
                      <Field label="Key" required hint="Lower-case, used for storage">
                        <Input
                          value={field.key}
                          onChange={(e) => {
                            const next = [...typeDraft.attributes];
                            next[index] = { ...field, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') };
                            setTypeDraft({ ...typeDraft, attributes: next });
                          }}
                          placeholder="e.g. serial_number"
                        />
                      </Field>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <Field label="Field type">
                        <Select
                          value={field.fieldType}
                          onChange={(e) => {
                            const next = [...typeDraft.attributes];
                            next[index] = { ...field, fieldType: e.target.value as FieldDraft['fieldType'] };
                            setTypeDraft({ ...typeDraft, attributes: next });
                          }}
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="select">Dropdown</option>
                          <option value="date">Date</option>
                          <option value="checkbox">Yes / no</option>
                        </Select>
                      </Field>
                      <Field label="Options" hint={field.fieldType === 'select' ? 'Comma separated' : 'Not used'}>
                        <Input
                          value={field.options}
                          disabled={field.fieldType !== 'select'}
                          onChange={(e) => {
                            const next = [...typeDraft.attributes];
                            next[index] = { ...field, options: e.target.value };
                            setTypeDraft({ ...typeDraft, attributes: next });
                          }}
                          placeholder="Owned, Leased, Donated"
                        />
                      </Field>
                      <div className="flex items-end gap-2 pb-1">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(e) => {
                              const next = [...typeDraft.attributes];
                              next[index] = { ...field, required: e.target.checked };
                              setTypeDraft({ ...typeDraft, attributes: next });
                            }}
                          />
                          Required
                        </label>
                        <Button
                          variant="ghost"
                          aria-label="Remove field"
                          onClick={() =>
                            setTypeDraft({
                              ...typeDraft,
                              attributes: typeDraft.attributes.filter((_, i) => i !== index),
                            })
                          }
                          icon={<Trash2 className="h-4 w-4 text-red-500" />}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Callout tone="warning" title="Fields are kept, not deleted">
            <span className="flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              Removing a field retires it from the form but keeps any values already captured on existing assets.
            </span>
          </Callout>
        </div>
      </Modal>
    </div>
  );
}
