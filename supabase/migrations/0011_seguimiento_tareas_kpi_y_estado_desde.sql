-- Seguimiento de tareas, evolución semanal automática y "desde cuándo" está cada cámara en su estado.
alter table work_orders add column priority priority_level not null default 'media';

create table work_order_updates (
  id bigint generated always as identity primary key,
  work_order_id integer not null references work_orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  author_name text,
  kind text not null default 'avance' check (kind in ('avance','cierre','reapertura')),
  note text not null,
  progress smallint check (progress between 0 and 100),
  status work_status
);
create index work_order_updates_idx on work_order_updates(work_order_id, created_at);
alter table work_order_updates enable row level security;
create policy read_all on work_order_updates for select to authenticated using (app_role() is not null);
revoke all on work_order_updates from anon, authenticated;
grant select on work_order_updates to authenticated;
create trigger audit_work_order_updates after insert or update or delete on work_order_updates for each row execute function audit_row();

create or replace function register_work_update(p_work integer, p_note text, p_progress integer, p_status work_status, p_camera_ok boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare w work_orders; me text; kind text; cn text; prev_status work_status;
begin
  if app_role() not in ('admin','tecnico') then raise exception 'No tenés permiso para registrar avances'; end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'Escribí una nota del avance'; end if;
  select * into w from work_orders where id = p_work for update;
  if not found then raise exception 'La tarea no existe'; end if;
  prev_status := w.status;
  select name into me from people where user_id = auth.uid();
  kind := case when p_status = 'completado' and prev_status <> 'completado' then 'cierre'
               when prev_status = 'completado' and p_status <> 'completado' then 'reapertura' else 'avance' end;
  update work_orders set status = p_status,
      progress = case when p_status = 'completado' then 100 else greatest(0, least(100, p_progress)) end,
      completed_at = case when p_status = 'completado' then coalesce(completed_at, current_date) else null end
    where id = p_work;
  insert into work_order_updates(work_order_id, author_name, kind, note, progress, status)
    values (p_work, me, kind, trim(p_note), case when p_status = 'completado' then 100 else p_progress end, p_status);
  if kind = 'cierre' and p_camera_ok then update cameras set status = 'operativa' where id = w.camera_id and active; end if;
  if kind = 'cierre' then
    select '#' || id || ' ' || name into cn from cameras where id = w.camera_id;
    insert into alert_outbox(event_type, camera_id, work_id, subject, body) values ('work_done', w.camera_id, p_work,
      format('[Central de Monitoreo] Tarea #%s completada (cámara %s)', p_work, cn),
      format('La tarea #%s (%s) de la cámara %s fue completada por %s.%sComentario de cierre: %s%s%sVer panel: https://central-monitoreo-dashboard.vercel.app/admin',
             p_work, w.task_type, cn, coalesce(me,'un operador'), E'\n', trim(p_note), E'\n', E'\n'));
  end if;
end $$;
revoke execute on function register_work_update(integer, text, integer, work_status, boolean) from public, anon;
grant execute on function register_work_update(integer, text, integer, work_status, boolean) to authenticated;

alter table cameras add column status_since timestamptz;
update cameras c set status_since = coalesce(
  (select max(a.at) from audit_log a where a.table_name = 'cameras' and a.row_id = c.id::text and a.action = 'UPDATE' and a.old_data->>'status' is distinct from a.new_data->>'status'),
  (select min(at) from audit_log where table_name = 'cameras'));
alter table cameras alter column status_since set not null, alter column status_since set default now();
create or replace function set_status_since() returns trigger language plpgsql set search_path = public as $$
begin if new.status is distinct from old.status then new.status_since := now(); end if; return new; end $$;
create trigger cameras_status_since before update of status on cameras for each row execute function set_status_since();

create or replace function take_kpi_snapshot() returns void language plpgsql security definer set search_path = public as $$
begin
  insert into kpi_snapshots(week_label, date, operativas, sin_instalar, con_problema, trabajos_completados, trabajos_en_proceso, coverage, notes)
  select 'Semana ' || to_char(current_date, 'IW/IYYY'), current_date,
    count(*) filter (where status = 'operativa'), count(*) filter (where status = 'sin_instalar'),
    count(*) filter (where status in ('falta_red','sin_senal','falla','mantenimiento')),
    (select count(*) from work_orders where status = 'completado'), (select count(*) from work_orders where status = 'en_proceso'),
    round(100.0 * count(*) filter (where status = 'operativa') / nullif(count(*), 0), 1), 'Registro automático'
  from cameras where active
  on conflict (date) do update set operativas = excluded.operativas, sin_instalar = excluded.sin_instalar, con_problema = excluded.con_problema,
    trabajos_completados = excluded.trabajos_completados, trabajos_en_proceso = excluded.trabajos_en_proceso, coverage = excluded.coverage;
end $$;
revoke execute on function take_kpi_snapshot(), set_status_since() from public, anon, authenticated;
select cron.schedule('kpi-semanal', '0 11 * * 1', $$select take_kpi_snapshot()$$);
