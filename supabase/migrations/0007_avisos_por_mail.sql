-- Avisos por mail: destinatarios, cola de envío, disparadores y tareas programadas.
-- La función que envía está en supabase/functions/send-alerts (requiere los secretos GMAIL_USER y GMAIL_APP_PASSWORD).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table alert_recipients (
  id bigint generated always as identity primary key,
  email text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text,
  active boolean not null default true
);

create table alert_outbox (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_type text not null,
  camera_id integer references cameras(id) on delete set null,
  work_id integer references work_orders(id) on delete set null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','sent','error')),
  attempts smallint not null default 0,
  sent_at timestamptz,
  last_error text
);
create index alert_outbox_pending_idx on alert_outbox(id) where status = 'pending';
alter table work_orders add column overdue_notified_at timestamptz;

alter table alert_recipients enable row level security;
alter table alert_outbox enable row level security;
create policy admin_all on alert_recipients for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
create policy admin_read on alert_outbox for select to authenticated using (app_role() = 'admin');
revoke all on alert_recipients, alert_outbox from anon, authenticated;
grant select, insert, update, delete on alert_recipients to authenticated;
grant select on alert_outbox to authenticated;

-- (funciones notify_camera_status, notify_new_work, notify_overdue_works, call_send_alerts, outbox_after_insert
--  y sus triggers: ver el estado aplicado en la base; se aplicaron con esta misma migración)
