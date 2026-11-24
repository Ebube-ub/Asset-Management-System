-- I4nnova Asset Management System — Release 1 schema
-- PostgreSQL (runs on embedded PGlite in development)

create sequence if not exists request_ref_seq;
create sequence if not exists asset_ref_seq;

-- ============================================================
-- Organisation context
-- ============================================================
create table if not exists staff (
  id uuid primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  job_title text,
  manager_id uuid references staff(id),
  first_signed_in_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists staff_manager_idx on staff(manager_id);

create table if not exists staff_role (
  staff_id uuid not null references staff(id) on delete cascade,
  role text not null check (role in ('team_lead','line_manager','stock_manager','financial_executive','administrator')),
  primary key (staff_id, role)
);

create table if not exists room (
  id uuid primary key,
  name text not null unique,
  building text,
  floor text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Asset Register context (asset_type referenced by requisition)
-- ============================================================
create table if not exists asset_type (
  id uuid primary key,
  name text not null unique,
  custody_kind text not null check (custody_kind in ('person','location')),
  category text not null default 'General',
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Requisition context
-- ============================================================
create table if not exists request (
  id uuid primary key,
  ref text not null unique,
  raised_by uuid not null references staff(id),
  raised_for uuid not null references staff(id),
  raised_at timestamptz not null default now(),
  justification text not null,
  priority text not null check (priority in ('critical','high','medium','low')),
  priority_justification text,
  business_impact text,
  status text not null check (status in ('raised','under_review','rejected','in_progress','fulfilled','partly_fulfilled','closed','cancelled')),
  current_reviewer_id uuid references staff(id),
  review_restarts integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists request_status_idx on request(status);
create index if not exists request_raised_for_idx on request(raised_for);
create index if not exists request_reviewer_idx on request(current_reviewer_id);

create table if not exists request_line (
  id uuid primary key,
  request_id uuid not null references request(id) on delete cascade,
  asset_type_id uuid not null references asset_type(id),
  quantity integer not null check (quantity > 0),
  recipient_room_id uuid references room(id),
  note text
);
create index if not exists request_line_request_idx on request_line(request_id);

create table if not exists request_item (
  id uuid primary key,
  request_line_id uuid not null references request_line(id) on delete cascade,
  seq integer not null,
  status text not null check (status in ('requested','awaiting_quotation','awaiting_decision','approved','parked','purchased','issued','closed')),
  closed_reason text check (closed_reason in ('declined','unavailable','cancelled')),
  review_due_at timestamptz,
  issued_asset_id uuid,
  updated_at timestamptz not null default now(),
  check ((status = 'closed') = (closed_reason is not null))
);
create index if not exists request_item_line_idx on request_item(request_line_id);
create index if not exists request_item_status_idx on request_item(status);

create table if not exists financial_decision (
  id uuid primary key,
  request_line_id uuid not null references request_line(id) on delete cascade,
  decision text not null check (decision in ('approve','decline','defer')),
  approved_amount numeric(14,2),
  decided_by uuid not null references staff(id),
  decided_at timestamptz not null default now(),
  note text
);
create index if not exists financial_decision_line_idx on financial_decision(request_line_id);

create table if not exists request_history (
  id uuid primary key,
  request_id uuid not null references request(id) on delete cascade,
  request_line_id uuid,
  request_item_id uuid,
  event text not null,
  by_staff_id uuid references staff(id),
  at timestamptz not null default now(),
  note text
);
create index if not exists request_history_request_idx on request_history(request_id);

-- ============================================================
-- Procurement Record context
-- ============================================================
create table if not exists quote (
  id uuid primary key,
  request_line_id uuid not null references request_line(id) on delete cascade,
  vendor_name text not null,
  amount numeric(14,2) not null check (amount > 0),
  delivery_days integer not null check (delivery_days >= 0),
  warranty_months integer not null check (warranty_months >= 0),
  quality_rating integer not null check (quality_rating between 1 and 5),
  document_url text,
  document_name text,
  recorded_by uuid not null references staff(id),
  recorded_at timestamptz not null default now()
);
create index if not exists quote_line_idx on quote(request_line_id);

create table if not exists quote_choice (
  id uuid primary key,
  request_line_id uuid not null unique references request_line(id) on delete cascade,
  recommended_quote_id uuid references quote(id),
  chosen_quote_id uuid not null references quote(id),
  weights_used jsonb not null,
  reason text,
  chosen_by uuid not null references staff(id),
  chosen_at timestamptz not null default now()
);

create table if not exists purchase (
  id uuid primary key,
  request_line_id uuid not null references request_line(id) on delete cascade,
  quote_id uuid references quote(id),
  vendor_name text not null,
  cost numeric(14,2) not null check (cost >= 0),
  receipt_url text,
  receipt_name text,
  recorded_by uuid not null references staff(id),
  recorded_at timestamptz not null default now()
);
create index if not exists purchase_line_idx on purchase(request_line_id);

create table if not exists scoring_weights (
  id uuid primary key,
  price integer not null,
  quality integer not null,
  delivery integer not null,
  warranty integer not null,
  set_by uuid references staff(id),
  effective_from timestamptz not null default now(),
  is_active boolean not null default true,
  check (price + quality + delivery + warranty = 100)
);

-- ============================================================
-- Asset Register context
-- ============================================================
create table if not exists asset (
  id uuid primary key,
  ref text not null unique,
  asset_type_id uuid not null references asset_type(id),
  serial_number text,
  condition text not null check (condition in ('new','good','fair','poor')),
  status text not null check (status in ('available','assigned','awaiting_disposal','disposed')),
  holder_staff_id uuid references staff(id),
  room_id uuid references room(id),
  purchase_id uuid references purchase(id),
  request_item_id uuid,
  registered_at timestamptz not null default now(),
  registered_by uuid references staff(id),
  notes text,
  check (
    (status = 'assigned' and ((holder_staff_id is not null)::int + (room_id is not null)::int = 1))
    or (status <> 'assigned' and holder_staff_id is null and room_id is null)
  )
);
create index if not exists asset_status_idx on asset(status);
create index if not exists asset_type_idx on asset(asset_type_id);
create index if not exists asset_holder_idx on asset(holder_staff_id);
create index if not exists asset_room_idx on asset(room_id);

create table if not exists asset_history (
  id uuid primary key,
  asset_id uuid not null references asset(id) on delete cascade,
  event text not null,
  from_holder text,
  to_holder text,
  by_staff_id uuid references staff(id),
  at timestamptz not null default now(),
  note text
);
create index if not exists asset_history_asset_idx on asset_history(asset_id);

create table if not exists disposal (
  id uuid primary key,
  asset_id uuid not null references asset(id),
  method text not null check (method in ('sale','auction','scrap','donation','recycling')),
  reason text not null,
  proposed_by uuid not null references staff(id),
  proposed_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected','completed')),
  decided_by uuid references staff(id),
  decided_at timestamptz,
  decision_note text,
  proceeds numeric(14,2),
  buyer text,
  completed_at timestamptz
);
create index if not exists disposal_asset_idx on disposal(asset_id);

-- Every transfer and return is confirmed by the stock manager.
create table if not exists asset_movement (
  id uuid primary key,
  asset_id uuid not null references asset(id),
  kind text not null check (kind in ('transfer','return')),
  to_staff_id uuid references staff(id),
  to_room_id uuid references room(id),
  requested_by uuid not null references staff(id),
  requested_at timestamptz not null default now(),
  status text not null check (status in ('pending','confirmed','rejected')),
  confirmed_by uuid references staff(id),
  confirmed_at timestamptz,
  note text
);
create index if not exists asset_movement_status_idx on asset_movement(status);

-- ============================================================
-- Settings, sessions, documents
-- ============================================================
create table if not exists app_setting (
  key text primary key,
  value text not null
);

create table if not exists session (
  id uuid primary key,
  staff_id uuid not null references staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists session_staff_idx on session(staff_id);

create table if not exists document (
  id uuid primary key,
  name text not null,
  url text not null,
  mime text,
  size integer,
  uploaded_by uuid references staff(id),
  uploaded_at timestamptz not null default now()
);
