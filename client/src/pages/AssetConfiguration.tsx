import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Boxes, Building2, FolderTree, Layers, Plus, ShieldCheck, Tags, Trash2 } from 'lucide-react';
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
  approvalRole: string;
  approvalStage: string;
  minRequestRole: string;
  active: boolean;
  attributes: FieldDraft[];
};

const EMPTY_FIELD: FieldDraft = { key: '', label: '', fieldType: 'text', options: '', required: false };

const EMPTY_TYPE: TypeDraft = {
  name: '',
  custodyKind: 'person',
  categoryId: '',
  description: '',
  approvalRole: '',
  approvalStage: '',
  minRequestRole: '',
  active: true,
  attributes: [],
};

function approvalText(own: string | null, inherited: string | null, inheritedFrom: string): string {
  if (own) return `${ROLE_LABELS[own as Role]} approval`;
  if (inherited) return `Inherits ${ROLE_LABELS[inherited as Role].toLowerCase()} approval from ${inheritedFrom}`;
  return 'No extra approval';
}

export function AssetConfigurationPage() {
  const { push } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['asset-configuration'], queryFn: () => api<any>('/asset-configuration') });

  const [classOpen, setClassOpen] = useState(false);
  const [classEdit, setClassEdit] = useState<any | null>(null);
  const [classForm, setClassForm] = useState({
    name: '',
    description: '',
    approvalRole: '',
    approvalStage: '1',
    minRequestRole: '',
    active: true,
  });
  const [classConfirmDelete, setClassConfirmDelete] = useState(false);

  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryEdit, setCategoryEdit] = useState<any | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    classId: '',
    name: '',
    description: '',
    approvalRole: '',
    approvalStage: '1',
    minRequestRole: '',
    active: true,
  });
  const [categoryConfirmDelete, setCategoryConfirmDelete] = useState(false);

  const [typeOpen, setTypeOpen] = useState(false);
  const [typeDraft, setTypeDraft] = useState<TypeDraft>({ ...EMPTY_TYPE });
  const [typeConfirmDelete, setTypeConfirmDelete] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['asset-configuration'] });
    void qc.invalidateQueries({ queryKey: ['meta'] });
    void qc.invalidateQueries({ queryKey: ['asset-types'] });
  };

  const saveClass = useMutation({
    mutationFn: (payload: any) =>
      classEdit
        ? api(`/asset-classes/${classEdit.id}`, { method: 'PATCH', body: payload })
        : api('/asset-classes', { method: 'POST', body: payload }),
    onSuccess: () => {
      push(classEdit ? 'Asset class updated.' : 'Asset class created.', 'success');
      setClassOpen(false);
      setClassEdit(null);
      refresh();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const removeClass = useMutation({
    mutationFn: (id: string) => api(`/asset-classes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      push('Asset class deleted.', 'success');
      setClassOpen(false);
      setClassEdit(null);
      refresh();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

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

  const removeCategory = useMutation({
    mutationFn: (id: string) => api(`/asset-categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      push('Category deleted.', 'success');
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

  const removeType = useMutation({
    mutationFn: (id: string) => api(`/asset-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      push('Asset type deleted.', 'success');
      setTypeOpen(false);
      refresh();
    },
    onError: (e: Error) => push(e.message, 'error'),
  });

  const classes = query.data?.classes ?? [];
  const categories = query.data?.categories ?? [];
  const types = query.data?.types ?? [];
  const roleOptions = useMemo(() => Object.entries(ROLE_LABELS) as [Role, string][], []);

  const categoriesByClass = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const category of categories) {
      map.set(category.classId, [...(map.get(category.classId) ?? []), category]);
    }
    return map;
  }, [categories]);

  if (query.isLoading) return <Spinner label="Loading asset configuration…" />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;

  const openClass = (assetClass: any | null) => {
    setClassEdit(assetClass);
    setClassConfirmDelete(false);
    setClassForm({
      name: assetClass?.name ?? '',
      description: assetClass?.description ?? '',
      approvalRole: assetClass?.approvalRole ?? '',
      approvalStage: String(assetClass?.approvalStage ?? 1),
      minRequestRole: assetClass?.minRequestRole ?? '',
      active: assetClass?.active ?? true,
    });
    setClassOpen(true);
  };

  const openCategory = (category: any | null, classId?: string) => {
    setCategoryEdit(category);
    setCategoryConfirmDelete(false);
    setCategoryForm({
      classId: category?.classId ?? classId ?? classes[0]?.id ?? '',
      name: category?.name ?? '',
      description: category?.description ?? '',
      approvalRole: category?.approvalRole ?? '',
      approvalStage: String(category?.approvalStage ?? 1),
      minRequestRole: category?.minRequestRole ?? '',
      active: category?.active ?? true,
    });
    setCategoryOpen(true);
  };

  const openType = (type: any | null) => {
    setTypeConfirmDelete(false);
    setTypeDraft(
      type
        ? {
            id: type.id,
            name: type.name,
            custodyKind: type.custodyKind,
            categoryId: type.categoryId,
            description: type.description ?? '',
            approvalRole: type.approvalRole ?? '',
            approvalStage: type.approvalStage == null ? '' : String(type.approvalStage),
            minRequestRole: type.minRequestRole ?? '',
            active: type.active,
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
      approvalRole: typeDraft.approvalRole || null,
      approvalStage: typeDraft.approvalStage ? Number(typeDraft.approvalStage) : null,
      minRequestRole: typeDraft.minRequestRole || null,
      active: typeDraft.active,
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

  const selectedClassForCategory = classes.find((c: any) => c.id === categoryForm.classId);
  const selectedCategoryForType = categories.find((c: any) => c.id === typeDraft.categoryId);
  const selectedClassForType = classes.find((c: any) => c.id === selectedCategoryForType?.classId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Asset Configuration</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            One hierarchy for every item: <span className="font-medium text-slate-600">Asset class</span> →{' '}
            <span className="font-medium text-slate-600">Asset category</span> →{' '}
            <span className="font-medium text-slate-600">Asset type</span> → individual asset.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openClass(null)} icon={<Building2 className="h-4 w-4" />}>
            New class
          </Button>
          <Button
            variant="outline"
            onClick={() => openCategory(null)}
            icon={<Layers className="h-4 w-4" />}
            disabled={classes.length === 0}
          >
            New category
          </Button>
          <Button onClick={() => openType(null)} icon={<Plus className="h-4 w-4" />} disabled={categories.length === 0}>
            New asset type
          </Button>
        </div>
      </div>

      <Callout tone="info" title="How approval rules resolve">
        A rule set on an asset type overrides its category, which overrides its class. Leave a level blank to inherit
        from the level above, so one class can need no extra approval while another requires a line manager or
        administrator. The reporting line always reviews a request first. A minimum role works the same way and is
        enforced on the server, even if someone calls the API directly.
      </Callout>

      {/* ---------------------------------------------------------------- */}
      {/* Asset classes                                                     */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Asset classes"
          subtitle="The top level: broad groupings with their own default approval and access rules"
          action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{classes.length}</Badge>}
        />
        {classes.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="No asset classes yet"
            message="Create a class such as IT Equipment or Furniture before adding categories."
          />
        ) : (
          <div className="divide-y divide-slate-50">
            {classes.map((assetClass: any) => {
              const classCategories = categoriesByClass.get(assetClass.id) ?? [];
              return (
                <div key={assetClass.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-ink">{assetClass.name}</p>
                        <Badge className="bg-brand-50 text-brand-600 ring-brand-200">
                          {assetClass.categoryCount} categor{assetClass.categoryCount === 1 ? 'y' : 'ies'}
                        </Badge>
                        <Badge className="bg-slate-100 text-slate-600 ring-slate-200">
                          {assetClass.typeCount} type{assetClass.typeCount === 1 ? '' : 's'}
                        </Badge>
                        {assetClass.approvalRole ? (
                          <Badge className="bg-violet-50 text-violet-700 ring-violet-200">
                            <ShieldCheck className="h-3 w-3" /> {ROLE_LABELS[assetClass.approvalRole as Role]} default
                          </Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-600 ring-slate-200">No class approval default</Badge>
                        )}
                        {assetClass.minRequestRole ? (
                          <Badge className="bg-amber-50 text-amber-700 ring-amber-200">
                            {ROLE_LABELS[assetClass.minRequestRole as Role]} and above only
                          </Badge>
                        ) : null}
                        {!assetClass.active ? (
                          <Badge className="bg-slate-100 text-slate-500 ring-slate-200">Inactive</Badge>
                        ) : null}
                      </div>
                      {assetClass.description ? (
                        <p className="mt-1 max-w-2xl text-[11.5px] text-slate-500">{assetClass.description}</p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-slate-400">
                        {assetClass.assetCount} registered asset(s) · {classCategories.length} categor
                        {classCategories.length === 1 ? 'y' : 'ies'}
                      </p>
                      {classCategories.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {classCategories.map((category: any) => (
                            <button
                              key={category.id}
                              type="button"
                              onClick={() => openCategory(category)}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-200"
                            >
                              {category.name}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openCategory(null, assetClass.id)}>
                        Add category
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openClass(assetClass)}>
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Asset categories                                                  */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Asset categories"
          subtitle="Each category belongs to one class and inherits the class rules unless it overrides them"
          action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{categories.length}</Badge>}
        />
        {categories.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-6 w-6" />}
            title="No categories yet"
            message="Create a category inside an asset class before adding asset types."
          />
        ) : (
          <div className="divide-y divide-slate-50">
            {categories.map((category: any) => (
              <div key={category.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-semibold text-ink">{category.name}</p>
                    <Badge className="bg-brand-50 text-brand-600 ring-brand-200">{category.className}</Badge>
                    <Badge className="bg-violet-50 text-violet-700 ring-violet-200">
                      <ShieldCheck className="h-3 w-3" />
                      {approvalText(category.approvalRole, category.classApprovalRole, category.className)}
                    </Badge>
                    {category.minRequestRole ? (
                      <Badge className="bg-amber-50 text-amber-700 ring-amber-200">
                        {ROLE_LABELS[category.minRequestRole as Role]} and above only
                      </Badge>
                    ) : category.classMinRequestRole ? (
                      <Badge className="bg-amber-50 text-amber-700 ring-amber-200">
                        Inherits {ROLE_LABELS[category.classMinRequestRole as Role]} and above
                      </Badge>
                    ) : null}
                    {!category.active ? (
                      <Badge className="bg-slate-100 text-slate-500 ring-slate-200">Inactive</Badge>
                    ) : null}
                    {!category.classActive ? (
                      <Badge className="bg-red-50 text-red-600 ring-red-200">Class inactive</Badge>
                    ) : null}
                  </div>
                  {category.description ? (
                    <p className="mt-1 max-w-xl text-[11.5px] text-slate-500">{category.description}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-slate-400">
                    {category.typeCount} asset type(s) · {category.assetCount} registered asset(s)
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => openCategory(category)}>
                  Edit
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Asset types                                                       */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Asset types and their fields"
          subtitle="Each type belongs to one category; its fields are the only ones shown when an asset is registered"
          action={<Badge className="bg-slate-100 text-slate-600 ring-slate-200">{types.length}</Badge>}
        />
        {types.length === 0 ? (
          <EmptyState icon={<Tags className="h-6 w-6" />} title="No asset types yet" />
        ) : (
          <div className="divide-y divide-slate-50">
            {types.map((type: any) => (
              <div key={type.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold text-ink">{type.name}</p>
                      <Badge className="bg-brand-50 text-brand-600 ring-brand-200">{type.className}</Badge>
                      <Badge className="bg-slate-100 text-slate-600 ring-slate-200">{type.categoryName}</Badge>
                      <Badge className="bg-slate-100 text-slate-600 ring-slate-200">
                        {type.custodyKind === 'person' ? 'Held by a person' : 'Held by a location'}
                      </Badge>
                      <Badge className="bg-violet-50 text-violet-700 ring-violet-200">
                        {type.effectiveApprovalRole ? (
                          `${ROLE_LABELS[type.effectiveApprovalRole as Role]} approval`
                        ) : (
                          'No extra approval'
                        )}
                      </Badge>
                      {!type.active ? (
                        <Badge className="bg-slate-100 text-slate-500 ring-slate-200">Inactive</Badge>
                      ) : null}
                      {!type.categoryActive || !type.classActive ? (
                        <Badge className="bg-red-50 text-red-600 ring-red-200">Parent inactive</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {type.totalCount} registered · {type.availableCount} available · {type.assignedCount} assigned ·{' '}
                      {type.attributeCount} field(s)
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => openType(type)}>
                    Edit type &amp; fields
                  </Button>
                </div>
                {type.attributes.filter((a: any) => a.active).length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {type.attributes
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
                  <p className="mt-2 text-[11px] text-slate-400">
                    No extra fields — this type captures serial, condition and notes only.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Class modal                                                       */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        open={classOpen}
        onClose={() => setClassOpen(false)}
        title={classEdit ? 'Edit asset class' : 'New asset class'}
        description="Defaults set here apply to every category and type in the class unless they override them."
        footer={
          <>
            {classEdit ? (
              classConfirmDelete ? (
                <div className="mr-auto flex items-center gap-2">
                  <span className="text-[11px] text-red-600">Delete permanently?</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => removeClass.mutate(classEdit.id)}
                    loading={removeClass.isPending}
                  >
                    Yes, delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setClassConfirmDelete(false)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="mr-auto text-red-600"
                  onClick={() => setClassConfirmDelete(true)}
                  icon={<Trash2 className="h-4 w-4" />}
                >
                  Delete
                </Button>
              )
            ) : null}
            <Button variant="outline" onClick={() => setClassOpen(false)} disabled={saveClass.isPending}>
              Cancel
            </Button>
            <Button
              loading={saveClass.isPending}
              onClick={() =>
                saveClass.mutate({
                  name: classForm.name,
                  description: classForm.description || null,
                  approvalRole: classForm.approvalRole || null,
                  approvalStage: Number(classForm.approvalStage) || 1,
                  minRequestRole: classForm.minRequestRole || null,
                  active: classForm.active,
                })
              }
            >
              {classEdit ? 'Save class' : 'Create class'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Class name" required>
            <Input
              value={classForm.name}
              onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
              placeholder="e.g. IT Equipment"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={classForm.description}
              onChange={(e) => setClassForm({ ...classForm, description: e.target.value })}
              className="min-h-[70px]"
              placeholder="What belongs in this class?"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_0.6fr]">
            <Field
              label="Default approval level"
              hint="Inherited by categories and types. After the reporting-line review, a holder of this role must approve before stock is checked."
            >
              <Select
                value={classForm.approvalRole}
                onChange={(e) => setClassForm({ ...classForm, approvalRole: e.target.value })}
              >
                <option value="">No extra approval</option>
                {roleOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Approval order" hint="1 runs first when several levels apply.">
              <Input
                type="number"
                min={1}
                max={20}
                value={classForm.approvalStage}
                disabled={!classForm.approvalRole}
                onChange={(e) => setClassForm({ ...classForm, approvalStage: e.target.value })}
              />
            </Field>
          </div>
          <Field
            label="Who may request this class?"
            hint="Leave empty for everyone. Otherwise the server rejects requests from anyone below this level."
          >
            <Select
              value={classForm.minRequestRole}
              onChange={(e) => setClassForm({ ...classForm, minRequestRole: e.target.value })}
            >
              <option value="">Everyone</option>
              {roleOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label} and above
                </option>
              ))}
            </Select>
          </Field>
          {classEdit ? (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={classForm.active}
                onChange={(e) => setClassForm({ ...classForm, active: e.target.checked })}
              />
              Active (available for new requests)
            </label>
          ) : null}
          <Callout tone="warning" title="Records are kept, not removed">
            <span className="flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              A class that still contains categories cannot be deleted. Set it to inactive instead — it disappears from
              new requests but stays on historical records.
            </span>
          </Callout>
        </div>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Category modal                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        title={categoryEdit ? 'Edit category' : 'New asset category'}
        description="A category must belong to an asset class. Leave a rule empty to inherit it from the class."
        footer={
          <>
            {categoryEdit ? (
              categoryConfirmDelete ? (
                <div className="mr-auto flex items-center gap-2">
                  <span className="text-[11px] text-red-600">Delete permanently?</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => removeCategory.mutate(categoryEdit.id)}
                    loading={removeCategory.isPending}
                  >
                    Yes, delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCategoryConfirmDelete(false)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="mr-auto text-red-600"
                  onClick={() => setCategoryConfirmDelete(true)}
                  icon={<Trash2 className="h-4 w-4" />}
                >
                  Delete
                </Button>
              )
            ) : null}
            <Button variant="outline" onClick={() => setCategoryOpen(false)} disabled={saveCategory.isPending}>
              Cancel
            </Button>
            <Button
              loading={saveCategory.isPending}
              onClick={() =>
                saveCategory.mutate({
                  classId: categoryForm.classId,
                  name: categoryForm.name,
                  description: categoryForm.description || null,
                  approvalRole: categoryForm.approvalRole || null,
                  approvalStage: Number(categoryForm.approvalStage) || 1,
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
          <Field label="Asset class" required hint="The category lives inside this class.">
            <Select
              value={categoryForm.classId}
              onChange={(e) => setCategoryForm({ ...categoryForm, classId: e.target.value })}
            >
              <option value="">Choose an asset class…</option>
              {classes.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!c.active ? ' (inactive)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category name" required>
            <Input
              value={categoryForm.name}
              onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
              placeholder="e.g. Computing Devices"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={categoryForm.description}
              onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
              className="min-h-[70px]"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_0.6fr]">
            <Field label="Approval level" hint="Leave on inherit unless this category genuinely differs.">
              <Select
                value={categoryForm.approvalRole}
                onChange={(e) => setCategoryForm({ ...categoryForm, approvalRole: e.target.value })}
              >
                <option value="">
                  Inherit from {selectedClassForCategory?.name ?? 'class'}
                  {selectedClassForCategory?.approvalRole
                    ? ` (${ROLE_LABELS[selectedClassForCategory.approvalRole as Role]})`
                    : ' (no extra approval)'}
                </option>
                {roleOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Approval order" hint="Used only when this category sets a level.">
              <Input
                type="number"
                min={1}
                max={20}
                value={categoryForm.approvalStage}
                disabled={!categoryForm.approvalRole}
                onChange={(e) => setCategoryForm({ ...categoryForm, approvalStage: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Who may request this category?" hint="Leave on inherit to use the class restriction.">
            <Select
              value={categoryForm.minRequestRole}
              onChange={(e) => setCategoryForm({ ...categoryForm, minRequestRole: e.target.value })}
            >
              <option value="">
                Inherit from {selectedClassForCategory?.name ?? 'class'}
                {selectedClassForCategory?.minRequestRole
                  ? ` (${ROLE_LABELS[selectedClassForCategory.minRequestRole as Role]} and above)`
                  : ' (everyone)'}
              </option>
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
              Active (available for new requests)
            </label>
          ) : null}
          <Callout tone="warning" title="Categories in use cannot be deleted">
            <span className="flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              A category that still contains asset types cannot be deleted. Deactivate it to keep historical assets and
              requests readable while removing it from new requests.
            </span>
          </Callout>
        </div>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Asset type modal                                                  */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        open={typeOpen}
        onClose={() => setTypeOpen(false)}
        title={typeDraft.id ? 'Edit asset type' : 'New asset type'}
        description="The fields here are the only ones shown for this type when an asset is registered."
        width="max-w-2xl"
        footer={
          <>
            {typeDraft.id ? (
              typeConfirmDelete ? (
                <div className="mr-auto flex items-center gap-2">
                  <span className="text-[11px] text-red-600">Delete permanently?</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => removeType.mutate(typeDraft.id!)}
                    loading={removeType.isPending}
                  >
                    Yes, delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setTypeConfirmDelete(false)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="mr-auto text-red-600"
                  onClick={() => setTypeConfirmDelete(true)}
                  icon={<Trash2 className="h-4 w-4" />}
                >
                  Delete
                </Button>
              )
            ) : null}
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
          <Field label="Asset category" required hint="The type inherits its class and category rules.">
            <Select
              value={typeDraft.categoryId}
              onChange={(e) => setTypeDraft({ ...typeDraft, categoryId: e.target.value })}
            >
              <option value="">Choose an asset category…</option>
              {classes.map((assetClass: any) => {
                const options = categories.filter((c: any) => c.classId === assetClass.id);
                if (!options.length) return null;
                return (
                  <optgroup key={assetClass.id} label={assetClass.name}>
                    {options.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {!c.active ? ' (inactive)' : ''}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Select>
          </Field>
          {selectedClassForType ? (
            <p className="-mt-1 text-[11px] text-slate-400">
              {selectedClassForType.name} · {selectedCategoryForType?.name}
            </p>
          ) : null}
          <Field label="Name" required>
            <Input
              value={typeDraft.name}
              onChange={(e) => setTypeDraft({ ...typeDraft, name: e.target.value })}
              placeholder="e.g. Office Chair"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Custody" required hint="Changing this affects new assignments only, never history.">
              <Select
                value={typeDraft.custodyKind}
                onChange={(e) => setTypeDraft({ ...typeDraft, custodyKind: e.target.value as 'person' | 'location' })}
              >
                <option value="person">Held by a person</option>
                <option value="location">Held by a location</option>
              </Select>
            </Field>
            <Field label="Description">
              <Input
                value={typeDraft.description}
                onChange={(e) => setTypeDraft({ ...typeDraft, description: e.target.value })}
                placeholder="Optional"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1.4fr_0.6fr]">
            <Field label="Approval level" hint="Leave on inherit unless this type needs a different approver.">
              <Select
                value={typeDraft.approvalRole}
                onChange={(e) => setTypeDraft({ ...typeDraft, approvalRole: e.target.value })}
              >
                <option value="">
                  Inherit from {selectedCategoryForType?.name ?? 'category'}
                  {selectedCategoryForType?.effectiveApprovalRole
                    ? ` (${ROLE_LABELS[selectedCategoryForType.effectiveApprovalRole as Role]})`
                    : ' (no extra approval)'}
                </option>
                {roleOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Approval order" hint="Used only when this type sets a level.">
              <Input
                type="number"
                min={1}
                max={20}
                value={typeDraft.approvalStage}
                disabled={!typeDraft.approvalRole}
                onChange={(e) => setTypeDraft({ ...typeDraft, approvalStage: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Who may request this type?" hint="Leave on inherit to use the category restriction.">
            <Select
              value={typeDraft.minRequestRole}
              onChange={(e) => setTypeDraft({ ...typeDraft, minRequestRole: e.target.value })}
            >
              <option value="">
                Inherit from {selectedCategoryForType?.name ?? 'category'}
                {selectedCategoryForType?.effectiveMinRequestRole
                  ? ` (${ROLE_LABELS[selectedCategoryForType.effectiveMinRequestRole as Role]} and above)`
                  : ' (everyone)'}
              </option>
              {roleOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label} and above
                </option>
              ))}
            </Select>
          </Field>
          {typeDraft.id ? (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={typeDraft.active}
                onChange={(e) => setTypeDraft({ ...typeDraft, active: e.target.checked })}
              />
              Active (available for new requests and registrations)
            </label>
          ) : null}

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

          {typeDraft.id ? (
            <Callout tone="info" title="Linked types are kept">
              <span className="flex items-start gap-1.5">
                <Boxes className="mt-0.5 h-3 w-3 shrink-0" />
                A type linked to assets or request lines cannot be deleted — deactivate it instead so the register and
                history stay intact.
              </span>
            </Callout>
          ) : null}
        </div>
      </Modal>

      {/* Legend used only for orientation on small screens. */}
      <p className="flex flex-wrap items-center gap-1.5 pb-2 text-[11px] text-slate-400">
        <FolderTree className="h-3.5 w-3.5" />
        Hierarchy: class → category → type → asset. Inactive records stay on historical requests and assets but are not
        offered for new work.
      </p>
    </div>
  );
}
