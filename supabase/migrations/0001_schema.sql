-- Central de Monitoreo — esquema base (Fase 1)
-- Ejecutar SOLO en el proyecto Supabase dedicado a la Central de Monitoreo.

create type camera_status as enum ('operativa','sin_instalar','falta_red','sin_senal','falla','mantenimiento');
create type priority_level as enum ('alta','media','baja');
create type work_status as enum ('no_iniciado','en_proceso','completado','demorado','cancelado');
create type user_role as enum ('admin','tecnico','lector');

create table people (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role user_role not null default 'lector',
  organization text,
  active boolean not null default true
);

create or replace function app_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from people where user_id = auth.uid() and active
$$;

create table epe_contracts (
  id bigint generated always as identity primary key,
  supply_number text not null unique,
  holder text,
  address text,
  status text,
  notes text
);

create table cameras (
  id integer primary key,
  name text not null,
  model text,
  camera_type text,
  function text,
  address text,
  lat numeric(9,6) check (lat between -90 and 90),
  lng numeric(9,6) check (lng between -180 and 180),
  status camera_status not null default 'sin_instalar',
  priority priority_level not null default 'media',
  ip inet unique,
  mac text,
  serial text,
  network_notes text,
  installed_at date check (installed_at between '2000-01-01' and '2100-12-31'),
  last_review_at date check (last_review_at between '2000-01-01' and '2100-12-31'),
  notes text,
  epe_contract_id bigint references epe_contracts(id),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table work_orders (
  id integer primary key,
  camera_id integer not null references cameras(id),
  task_type text not null,
  start_date date check (start_date between '2000-01-01' and '2100-12-31'),
  due_date date check (due_date between '2000-01-01' and '2100-12-31'),
  status work_status not null default 'no_iniciado',
  progress smallint not null default 0 check (progress between 0 and 100),
  assignee text,
  notes text,
  completed_at date,
  updated_at timestamptz not null default now()
);

create table logbook (
  id bigint generated always as identity primary key,
  date date not null check (date between '2000-01-01' and '2100-12-31'),
  camera_id integer references cameras(id),
  technician text,
  type text,
  description text not null,
  result text,
  next_action text,
  work_order_id integer references work_orders(id),
  created_by uuid references auth.users(id) default auth.uid()
);

create table kpi_snapshots (
  id bigint generated always as identity primary key,
  week_label text,
  date date not null unique,
  operativas int not null,
  sin_instalar int not null,
  con_problema int not null,
  trabajos_completados int not null,
  trabajos_en_proceso int not null,
  coverage numeric(5,1) not null,
  notes text
);

create table audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  user_id uuid default auth.uid(),
  at timestamptz not null default now()
);

create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(table_name,row_id,action,old_data,new_data)
  values (tg_table_name,
          coalesce((to_jsonb(new)->>'id'),(to_jsonb(old)->>'id')),
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['cameras','work_orders','logbook','epe_contracts','people'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row()', t);
  end loop;
end $$;
create trigger touch_cameras before update on cameras for each row execute function touch_updated_at();
create trigger touch_work_orders before update on work_orders for each row execute function touch_updated_at();

-- RLS: nada es accesible sin login; anon solo ve las vistas públicas de 0002.
alter table people enable row level security;
alter table epe_contracts enable row level security;
alter table cameras enable row level security;
alter table work_orders enable row level security;
alter table logbook enable row level security;
alter table kpi_snapshots enable row level security;
alter table audit_log enable row level security;

create policy people_self on people for select to authenticated using (user_id = auth.uid() or app_role() = 'admin');
create policy people_admin on people for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');

create policy read_all on epe_contracts for select to authenticated using (app_role() is not null);
create policy admin_write on epe_contracts for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');

create policy read_all on cameras for select to authenticated using (app_role() is not null);
create policy admin_write on cameras for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');

create policy read_all on work_orders for select to authenticated using (app_role() is not null);
create policy staff_write on work_orders for all to authenticated using (app_role() in ('admin','tecnico')) with check (app_role() in ('admin','tecnico'));

create policy read_all on logbook for select to authenticated using (app_role() is not null);
create policy staff_write on logbook for all to authenticated using (app_role() in ('admin','tecnico')) with check (app_role() in ('admin','tecnico'));

create policy read_all on kpi_snapshots for select to authenticated using (app_role() is not null);
create policy admin_write on kpi_snapshots for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');

create policy admin_read on audit_log for select to authenticated using (app_role() = 'admin');

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
