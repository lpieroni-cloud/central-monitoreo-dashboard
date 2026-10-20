-- El operador informa en el acta; la administración decide y crea las tareas de mantenimiento.

-- 1) Solo la administración gestiona tareas
drop policy if exists staff_write on work_orders;
create policy admin_write on work_orders for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');

create or replace function register_work_update(p_work integer, p_note text, p_progress integer, p_status work_status, p_camera_ok boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare w work_orders; me text; kind text; cn text; prev_status work_status;
begin
  if app_role() <> 'admin' then raise exception 'Solo la administración puede registrar avances de tareas'; end if;
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
             p_work, w.task_type, cn, coalesce(me,'la administración'), E'\n', trim(p_note), E'\n', E'\n'));
  end if;
end $$;

-- 2) Solicitudes de intervención que nacen de las actas
alter table shift_entries
  add column needs_action boolean not null default false,
  add column handled_at timestamptz,
  add column handled_by uuid references auth.users(id),
  add column handled_task_id integer references work_orders(id) on delete set null,
  add column handled_note text;
grant insert (needs_action) on shift_entries to authenticated;
grant update (needs_action) on shift_entries to authenticated;
create index shift_entries_pending_idx on shift_entries(id) where needs_action and handled_at is null;

create or replace function entry_force_request() returns trigger language plpgsql set search_path = public as $$
begin if new.category = 'falla' then new.needs_action := true; end if; return new; end $$;
create trigger entry_force_request before insert or update of category on shift_entries for each row execute function entry_force_request();

create or replace function notify_action_request() returns trigger language plpgsql security definer set search_path = public as $$
declare cams text; s shifts; turno text;
begin
  if not new.needs_action then return new; end if;
  if tg_op = 'UPDATE' and old.needs_action then return new; end if;
  select * into s from shifts where id = new.shift_id;
  select string_agg('#' || c.id || ' ' || c.name, ', ' order by c.id) into cams from cameras c where c.id = any(new.camera_ids);
  turno := case s.shift_type when 'manana' then 'mañana' else s.shift_type end;
  insert into alert_outbox(event_type, camera_id, subject, body) values ('action_request', new.camera_ids[1],
    '[Central de Monitoreo] Solicitud de intervención: ' || coalesce(cams, 'sin cámara asociada'),
    'El operador ' || s.operator_name || ' informó en el acta del turno ' || turno || ' del ' || to_char(s.shift_date, 'DD/MM/YYYY') || ':' || E'\n\n' ||
    'Tipo: ' || initcap(new.category) || E'\n' || 'Cámaras: ' || coalesce(cams, '—') || E'\n' || 'Qué pasó: ' || new.description || E'\n' ||
    'Acción tomada: ' || coalesce(nullif(new.action_taken, ''), '—') || E'\n\n' ||
    'Para decidir qué hacer (reparar, limpiar, etc.) y crear la tarea, ingresá al panel: https://central-monitoreo-dashboard.vercel.app/admin');
  return new;
end $$;
create trigger entry_request_mail after insert or update of needs_action on shift_entries for each row execute function notify_action_request();

create or replace function resolve_request(p_entry bigint, p_task integer, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if app_role() <> 'admin' then raise exception 'Solo la administración puede atender solicitudes'; end if;
  update shift_entries set handled_at = now(), handled_by = auth.uid(), handled_task_id = p_task, handled_note = nullif(trim(p_note), '')
    where id = p_entry and needs_action and handled_at is null;
  if not found then raise exception 'La solicitud no existe o ya fue atendida'; end if;
end $$;
revoke execute on function resolve_request(bigint, integer, text), entry_force_request(), notify_action_request() from public, anon, authenticated;
grant execute on function resolve_request(bigint, integer, text) to authenticated;
