-- Actas de turno: cada acta es un registro; al cerrar el turno se guarda una copia congelada (snapshot) con numeración propia.
create sequence shift_acta_seq;

create table shifts (
  id bigint generated always as identity primary key,
  shift_date date not null check (shift_date between '2000-01-01' and '2100-12-31'),
  shift_type text not null check (shift_type in ('manana','tarde','noche')),
  operator_id uuid references auth.users(id) default auth.uid(),
  operator_name text not null,
  status text not null default 'abierta' check (status in ('abierta','cerrada')),
  opened_at timestamptz not null default now(),
  handover_notes text,
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  acta_no integer unique,
  snapshot jsonb,
  unique (shift_date, shift_type)
);

create table shift_entries (
  id bigint generated always as identity primary key,
  shift_id bigint not null references shifts(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  category text not null check (category in ('falla','novedad','intervencion','observacion')),
  description text not null,
  action_taken text,
  camera_ids integer[] not null default '{}',
  work_order_ids integer[] not null default '{}',
  created_by uuid references auth.users(id) default auth.uid()
);
create index shift_entries_shift_idx on shift_entries(shift_id, occurred_at);

alter table shifts enable row level security;
alter table shift_entries enable row level security;

create policy read_all on shifts for select to authenticated using (app_role() is not null);
create policy open_own on shifts for insert to authenticated
  with check (app_role() in ('admin','tecnico') and operator_id = auth.uid() and status = 'abierta');
create policy edit_open on shifts for update to authenticated
  using (status = 'abierta' and app_role() in ('admin','tecnico') and (operator_id = auth.uid() or app_role() = 'admin'))
  with check (status = 'abierta');

create policy read_all on shift_entries for select to authenticated using (app_role() is not null);
create policy write_open on shift_entries for all to authenticated
  using (app_role() in ('admin','tecnico') and exists (select 1 from shifts s where s.id = shift_id and s.status = 'abierta' and (s.operator_id = auth.uid() or app_role() = 'admin')))
  with check (app_role() in ('admin','tecnico') and exists (select 1 from shifts s where s.id = shift_id and s.status = 'abierta' and (s.operator_id = auth.uid() or app_role() = 'admin')));

revoke all on shifts, shift_entries from anon, authenticated;
grant select on shifts, shift_entries to authenticated;
grant insert (shift_date, shift_type, operator_name) on shifts to authenticated;
grant update (handover_notes) on shifts to authenticated;
grant insert (shift_id, occurred_at, category, description, action_taken, camera_ids, work_order_ids) on shift_entries to authenticated;
grant update (occurred_at, category, description, action_taken, camera_ids, work_order_ids) on shift_entries to authenticated;
grant delete on shift_entries to authenticated;

create trigger audit_shifts after insert or update or delete on shifts for each row execute function audit_row();
create trigger audit_shift_entries after insert or update or delete on shift_entries for each row execute function audit_row();

create sequence work_orders_id_seq owned by work_orders.id;
select setval('work_orders_id_seq', coalesce((select max(id) from work_orders), 0) + 1, false);
alter table work_orders alter column id set default nextval('work_orders_id_seq');

create or replace function report_cameras_status(p_cams integer[], p_status camera_status) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if app_role() not in ('admin','tecnico') then raise exception 'No tenés permiso para cambiar el estado de cámaras'; end if;
  update cameras set status = p_status where id = any(p_cams) and active;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function close_shift(p_shift bigint, p_handover text) returns integer
language plpgsql security definer set search_path = public as $$
declare s shifts; n integer; ts timestamptz := now(); snap jsonb; lines text; turno text;
begin
  select * into s from shifts where id = p_shift for update;
  if not found then raise exception 'El turno no existe'; end if;
  if app_role() not in ('admin','tecnico') or (s.operator_id is distinct from auth.uid() and app_role() <> 'admin') then
    raise exception 'No tenés permiso para cerrar este turno'; end if;
  if s.status <> 'abierta' then raise exception 'El turno ya está cerrado'; end if;
  n := coalesce(s.acta_no, nextval('shift_acta_seq'));
  snap := jsonb_build_object(
    'acta_no', n, 'shift_date', s.shift_date, 'shift_type', s.shift_type, 'operator', s.operator_name,
    'opened_at', s.opened_at, 'closed_at', ts, 'handover_notes', p_handover,
    'cameras', (select coalesce(jsonb_object_agg(st, c), '{}'::jsonb) from (select status::text st, count(*) c from cameras where active group by 1) q),
    'open_tasks', (select count(*) from work_orders where status not in ('completado','cancelado')),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object(
        'time', to_char(e.occurred_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI'),
        'category', e.category, 'description', e.description, 'action_taken', e.action_taken,
        'cameras', (select coalesce(jsonb_agg(c.id::text || ' ' || c.name order by c.id), '[]'::jsonb) from cameras c where c.id = any(e.camera_ids)),
        'work_orders', e.work_order_ids) order by e.occurred_at), '[]'::jsonb)
      from shift_entries e where e.shift_id = s.id));
  update shifts set status = 'cerrada', handover_notes = p_handover, closed_at = ts, closed_by = auth.uid(), acta_no = n, snapshot = snap where id = p_shift;
  turno := case s.shift_type when 'manana' then 'mañana' else s.shift_type end;
  select coalesce(string_agg('- ' || (e->>'time') || ' [' || (e->>'category') || '] ' ||
      case when jsonb_array_length(e->'cameras') > 0 then '(' || (select string_agg(x, ', ') from jsonb_array_elements_text(e->'cameras') x) || ') ' else '' end ||
      (e->>'description'), E'\n'), '- Sin novedades registradas') into lines
  from jsonb_array_elements(snap->'entries') e;
  insert into alert_outbox(event_type, subject, body) values ('shift_closed',
    format('[Central de Monitoreo] Acta N° %s cerrada - %s, turno %s', n, to_char(s.shift_date,'DD/MM/YYYY'), turno),
    format('Acta N° %s - Turno %s del %s%sOperador: %s%s%sNovedades:%s%s%s%sObservaciones de entrega: %s%s%sVer el acta completa en: https://central-monitoreo-dashboard.vercel.app/admin',
      n, turno, to_char(s.shift_date,'DD/MM/YYYY'), E'\n', s.operator_name, E'\n', E'\n', E'\n', lines, E'\n', E'\n', coalesce(nullif(p_handover,''),'ninguna'), E'\n', E'\n'));
  return n;
end $$;

create or replace function reopen_shift(p_shift bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if app_role() <> 'admin' then raise exception 'Solo un administrador puede reabrir un acta'; end if;
  update shifts set status = 'abierta', closed_at = null, closed_by = null, snapshot = null where id = p_shift;
end $$;

revoke execute on function report_cameras_status(integer[], camera_status), close_shift(bigint, text), reopen_shift(bigint) from public, anon;
grant execute on function report_cameras_status(integer[], camera_status), close_shift(bigint, text), reopen_shift(bigint) to authenticated;
