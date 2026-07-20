begin;

create extension if not exists pgcrypto;

create type public.user_role as enum ('owner', 'operator');
create type public.quotation_status as enum ('draft', 'finalised', 'voided');
create type public.payment_state as enum ('unpaid', 'partially_paid', 'paid', 'overpaid');
create type public.payment_method as enum ('cash', 'mpesa', 'bank', 'card', 'other');
create type public.payment_record_status as enum ('active', 'reversed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role public.user_role not null default 'operator',
  full_name text,
  created_at timestamptz not null default now()
);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  quote_number text unique not null,
  customer_name text,
  customer_phone text,
  customer_location text,
  customer_type text,
  quotation_date date not null default current_date,
  status public.quotation_status not null default 'draft',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount_type text not null default 'none' check (discount_type in ('none','fixed','percentage')),
  discount_value numeric(14,2) not null default 0 check (discount_value >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  pickup_fee numeric(14,2) not null default 0 check (pickup_fee >= 0),
  urgent_service_fee numeric(14,2) not null default 0 check (urgent_service_fee >= 0),
  other_charges numeric(14,2) not null default 0 check (other_charges >= 0),
  grand_total numeric(14,2) not null default 0 check (grand_total >= 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance_due numeric(14,2) not null default 0 check (balance_due >= 0),
  payment_status public.payment_state not null default 'unpaid',
  notes text,
  revision_number integer not null default 1 check (revision_number > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalised_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  imported_from_local_storage boolean not null default false,
  write_token_hash text
);

create table public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  category text not null,
  item_name text not null,
  unit_type text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  item_note text,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id),
  amount numeric(14,2) not null check (amount > 0),
  payment_method public.payment_method not null,
  payment_reference text,
  payment_date timestamptz not null default now(),
  received_by uuid references public.profiles(id),
  notes text,
  status public.payment_record_status not null default 'active',
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now()
);

create table public.quotation_events (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id),
  event_type text not null check (event_type in ('created','autosaved','saved','finalised','print_initiated','print_dialog_closed','pdf_generated','whatsapp_shared','revised','payment_recorded','payment_reversed','voided','imported')),
  event_time timestamptz not null default now(),
  actor_id uuid references public.profiles(id),
  actor_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  previous_values jsonb,
  new_values jsonb,
  actor_id uuid references public.profiles(id),
  actor_role text,
  created_at timestamptz not null default now()
);

create index quotations_number_idx on public.quotations(quote_number);
create index quotations_date_idx on public.quotations(quotation_date);
create index quotations_created_idx on public.quotations(created_at desc);
create index quotations_phone_idx on public.quotations(customer_phone);
create index quotations_status_idx on public.quotations(status, payment_status);
create index quotation_items_quote_idx on public.quotation_items(quotation_id);
create index quotation_items_name_idx on public.quotation_items(item_name);
create index payments_quote_idx on public.payments(quotation_id);
create index payments_date_idx on public.payments(payment_date desc);
create index events_quote_idx on public.quotation_events(quotation_id, event_time desc);
create index audit_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;
create or replace function public.is_operator() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('owner','operator'));
$$;
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger quotations_touch before update on public.quotations for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.payments enable row level security;
alter table public.quotation_events enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.is_owner());
create policy owner_all_quotes on public.quotations for all using (public.is_owner()) with check (public.is_owner());
create policy operator_own_quotes on public.quotations for select using (public.is_operator() and created_by = auth.uid());
create policy operator_create_quotes on public.quotations for insert with check (public.is_operator() and created_by = auth.uid());
create policy operator_update_drafts on public.quotations for update using (public.is_operator() and created_by = auth.uid() and status = 'draft') with check (created_by = auth.uid());
create policy owner_all_items on public.quotation_items for all using (public.is_owner()) with check (public.is_owner());
create policy operator_read_items on public.quotation_items for select using (exists(select 1 from public.quotations q where q.id = quotation_id and q.created_by = auth.uid()));
create policy operator_insert_items on public.quotation_items for insert with check (exists(select 1 from public.quotations q where q.id = quotation_id and q.created_by = auth.uid() and q.status = 'draft'));
create policy operator_update_items on public.quotation_items for update using (exists(select 1 from public.quotations q where q.id = quotation_id and q.created_by = auth.uid() and q.status = 'draft')) with check (exists(select 1 from public.quotations q where q.id = quotation_id and q.created_by = auth.uid() and q.status = 'draft'));
create policy owner_all_payments on public.payments for all using (public.is_owner()) with check (public.is_owner());
create policy operator_create_payments on public.payments for insert with check (public.is_operator() and received_by = auth.uid());
create policy owner_all_events on public.quotation_events for all using (public.is_owner()) with check (public.is_owner());
create policy operator_create_events on public.quotation_events for insert with check (public.is_operator() and actor_id = auth.uid());
create policy owner_audit_only on public.audit_logs for select using (public.is_owner());

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
revoke all on public.quotations, public.quotation_items, public.payments, public.quotation_events from anon;
grant select, insert, update on public.quotations, public.quotation_items, public.payments, public.quotation_events to authenticated;

commit;
