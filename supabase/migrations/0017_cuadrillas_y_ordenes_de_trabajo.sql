-- Protocolo de atención de fallas: equipos (cuadrilla eléctrica y SJVC), catálogo de problemas,
-- derivación automática desde el acta, acceso limitado de la cuadrilla y verificación por la operadora.

-- 1) Equipos, contactos y catálogo de problemas
create table teams (id text primary key, name text not null, active boolean not null default true);
insert into teams values ('electrica','Cuadrilla eléctrica',true), ('sjvc','SJVC',true);

create table team_contacts (
  id bigint generated always as identity primary key,
  team_id text not null references teams(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text,
  unique (team_id, email)
);

create table problem_types (
  code text primary key, label text not null, team_id text references teams(id),
  priority priority_level not null default 'media', due_hours integer, suggested_status camera_status,
  sort integer not null default 0, active boolean not null default true
);
insert into problem_types(code,label,team_id,priority,due_hours,suggested_status,sort) values
 ('sin_energia','Sin energía eléctrica','electrica','alta',24,'sin_senal',1),
 ('cable_danado','Cable cortado o dañado','electrica','alta',24,'sin_senal',2),
 ('soporte','Soporte o poste dañado / cámara desorientada','electrica','media',72,null,3),
 ('limpieza','Limpieza de lente','electrica','baja',168,null,4),
 ('sin_internet','Sin internet / sin señal','sjvc','alta',24,'falta_red',5),
 ('camara_danada','Cámara no enciende o imagen dañada','sjvc','alta',48,'falla',6),
 ('config_red','Configuración de red o grabador','sjvc','media',72,null,7),
 ('otro','Otro / no sé (la administración decide)',null,'media',null,null,8);

alter table people add column team_id text references teams(id);

create or replace function my_team() returns text language sql stable security definer set search_path = public as $$
  select team_id from people where user_id = auth.uid() and active $$;
revoke execute on function my_team() from public, anon;
grant execute on function my_team() to authenticated;

alter table teams enable row level security;
alter table team_contacts enable row level security;
alter table problem_types enable row level security;
create policy read_all on teams for select to authenticated using (app_role() is not null);
create policy read_all on problem_types for select to authenticated using (app_role() is not null);
create policy admin_all on team_contacts for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');
revoke all on teams, problem_types, team_contacts from anon, authenticated;
grant select on teams, problem_types to authenticated;
grant select, insert, update, delete on team_contacts to authenticated;

-- 2) Órdenes de trabajo con equipo, problema y verificación
alter table work_orders
  add column team_id text references teams(id),
  add column problem_type text references problem_types(code),
  add column source_entry_id bigint references shift_entries(id) on delete set null,
  add column verified_at timestamptz,
  add column verified_by uuid references auth.users(id),
  add column verify_note text;
alter table shift_entries add column problem_type text references problem_types(code);
grant insert (problem_type) on shift_entries to authenticated;
grant update (problem_type) on shift_entries to authenticated;
alter table work_order_updates drop constraint work_order_updates_kind_check;
alter table work_order_updates add constraint work_order_updates_kind_check check (kind in ('avance','cierre','reapertura','verificacion'));
create index work_orders_team_idx on work_orders(team_id, status);

-- 3) La cuadrilla solo ve sus órdenes: se retira la lectura general a ese rol
drop policy read_all on cameras;
create policy read_staff on cameras for select to authenticated using (app_role() in ('admin','tecnico','lector'));
drop policy read_all on epe_contracts;
create policy read_staff on epe_contracts for select to authenticated using (app_role() in ('admin','tecnico','lector'));
drop policy read_all on logbook;
create policy read_staff on logbook for select to authenticated using (app_role() in ('admin','tecnico','lector'));
drop policy read_all on shifts;
create policy read_staff on shifts for select to authenticated using (app_role() in ('admin','tecnico','lector'));
drop policy read_all on shift_entries;
create policy read_staff on shift_entries for select to authenticated using (app_role() in ('admin','tecnico','lector'));
drop policy read_all on work_orders;
create policy read_staff on work_orders for select to authenticated using (app_role() in ('admin','tecnico','lector'));
create policy team_read on work_orders for select to authenticated using (app_role() = 'cuadrilla' and team_id is not null and team_id = my_team());
drop policy read_all on work_order_updates;
create policy read_staff on work_order_updates for select to authenticated using (app_role() in ('admin','tecnico','lector'));
create policy team_read on work_order_updates for select to authenticated
  using (app_role() = 'cuadrilla' and exists (select 1 from work_orders w where w.id = work_order_id and w.team_id = my_team()));

-- Vista de cámaras para la cuadrilla: datos generales de todas; datos técnicos solo de las cámaras con orden de su equipo
create or replace view team_cameras as
select c.id, c.name, c.model, c.camera_type, c.function, c.address, c.zone, c.status, c.status_since, c.priority, c.last_review_at,
       c.lat, c.lng, c.azimuth_deg, c.fov_deg, c.range_m, c.coords_verified, c.active, c.notes,
       case when t.has then c.ip end as ip, case when t.has then c.mac end as mac, case when t.has then c.serial end as serial,
       case when t.has then c.link_type end as link_type, case when t.has then c.power_source end as power_source,
       case when t.has then c.network_notes end as network_notes,
       case when t.has then c.epe_contract_id end as epe_contract_id,
       case when t.has then (select e.supply_number from epe_contracts e where e.id = c.epe_contract_id) end as contract_number
from cameras c
cross join lateral (select exists (select 1 from work_orders w where w.camera_id = c.id and w.team_id = my_team() and w.status <> 'cancelado') as has) t
where app_role() = 'cuadrilla' and c.active;
revoke all on team_cameras from anon, authenticated;
grant select on team_cameras to authenticated;

-- 4) Derivación automática desde el acta
create or replace function derive_work_from_entry() returns trigger language plpgsql security definer set search_path = public as $$
declare pt problem_types; cid integer; oid integer; first_id integer; s shifts; created integer := 0; tname text; today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if new.problem_type is null then return new; end if;
  select * into pt from problem_types where code = new.problem_type and active;
  if not found then return new; end if;
  if pt.team_id is null then update shift_entries set needs_action = true where id = new.id; return new; end if;
  select * into s from shifts where id = new.shift_id;
  select name into tname from teams where id = pt.team_id;
  foreach cid in array new.camera_ids loop
    insert into work_orders(camera_id, task_type, priority, status, progress, start_date, due_date, assignee, notes, team_id, problem_type, source_entry_id)
    values (cid, pt.label, pt.priority, 'no_iniciado', 0, today, ((now() at time zone 'America/Argentina/Buenos_Aires') + make_interval(hours => coalesce(pt.due_hours, 72)))::date, tname,
            new.description || ' (informado por ' || s.operator_name || ' en el acta del ' || to_char(s.shift_date, 'DD/MM/YYYY') || ')', pt.team_id, pt.code, new.id)
    returning id into oid;
    first_id := coalesce(first_id, oid); created := created + 1;
  end loop;
  if created > 0 then
    update shift_entries set needs_action = true, handled_at = now(), handled_task_id = first_id,
      handled_note = 'Derivada automáticamente a ' || tname || ' (' || created || case when created > 1 then ' órdenes)' else ' orden)' end,
      work_order_ids = (select array_agg(id) from work_orders where source_entry_id = new.id) where id = new.id;
  else
    update shift_entries set needs_action = true where id = new.id;
  end if;
  return new;
end $$;
create trigger entry_derive after insert on shift_entries for each row execute function derive_work_from_entry();

create or replace function notify_action_request() returns trigger language plpgsql security definer set search_path = public as $$
declare cams text; s shifts; turno text;
begin
  if not new.needs_action or new.handled_at is not null then return new; end if;
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

-- 5) Aviso al equipo cuando se le asigna una orden
create or replace function notify_team_order() returns trigger language plpgsql security definer set search_path = public as $$
declare tn text; cam record; r record;
begin
  if new.team_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.team_id is not distinct from new.team_id then return new; end if;
  select name into tn from teams where id = new.team_id;
  select id, name, address into cam from cameras where id = new.camera_id;
  for r in select email from team_contacts where team_id = new.team_id loop
    insert into alert_outbox(event_type, camera_id, work_id, subject, body, to_email) values ('work_assigned', new.camera_id, new.id,
      '[Central de Monitoreo] Nueva orden de trabajo #' || new.id || ': ' || new.task_type || ' - cámara #' || cam.id || ' ' || cam.name,
      'Se asignó una orden de trabajo a ' || tn || ':' || E'\n\n' ||
      'Orden N° ' || new.id || E'\n' || 'Cámara: #' || cam.id || ' ' || cam.name || E'\n' || 'Dirección: ' || coalesce(cam.address, '—') || E'\n' ||
      'Problema: ' || new.task_type || E'\n' || 'Prioridad: ' || initcap(new.priority::text) || E'\n' ||
      'Plazo: hasta el ' || coalesce(to_char(new.due_date, 'DD/MM/YYYY'), 'sin fecha') || E'\n' || 'Detalle: ' || coalesce(new.notes, '—') || E'\n\n' ||
      'Ingresá al panel con el usuario de tu equipo, entrá a "Mantenimiento" y registrá el avance. Al terminar, tocá "Trabajo terminado": https://central-monitoreo-dashboard.vercel.app/admin',
      r.email);
  end loop;
  return new;
end $$;
create trigger notify_team_order after insert or update of team_id on work_orders for each row execute function notify_team_order();

create or replace function notify_overdue_works() returns void language plpgsql security definer set search_path = public as $$
begin
  insert into alert_outbox(event_type, camera_id, work_id, subject, body)
  select 'work_overdue', w.camera_id, w.id,
    format('[Central de Monitoreo] Trabajo #%s vencido (cámara #%s %s)', w.id, c.id, c.name),
    format('El trabajo #%s (%s) de la cámara #%s "%s" venció el %s y sigue %s (avance %s%%).%sResponsable: %s',
           w.id, w.task_type, c.id, c.name, to_char(w.due_date,'DD/MM/YYYY'), replace(w.status::text,'_',' '), w.progress, E'\n', coalesce(w.assignee,'sin asignar'))
  from work_orders w join cameras c on c.id = w.camera_id
  where w.due_date < current_date and w.status not in ('completado','cancelado') and w.overdue_notified_at is null;
  insert into alert_outbox(event_type, camera_id, work_id, subject, body, to_email)
  select 'work_overdue', w.camera_id, w.id,
    '[Central de Monitoreo] Orden #' || w.id || ' vencida - cámara #' || c.id || ' ' || c.name,
    'La orden #' || w.id || ' (' || w.task_type || ') de la cámara #' || c.id || ' ' || c.name || ' venció el ' || to_char(w.due_date,'DD/MM/YYYY') || ' y sigue pendiente.' || E'\n\n' ||
    'Ingresá al panel, entrá a "Mantenimiento" y registrá el avance o cerrala si ya está resuelta: https://central-monitoreo-dashboard.vercel.app/admin',
    tc.email
  from work_orders w join cameras c on c.id = w.camera_id join team_contacts tc on tc.team_id = w.team_id
  where w.due_date < current_date and w.status not in ('completado','cancelado') and w.overdue_notified_at is null and w.team_id is not null;
  update work_orders set overdue_notified_at = now()
  where due_date < current_date and status not in ('completado','cancelado') and overdue_notified_at is null;
end $$;

-- 6) Avances: administración y cuadrilla (solo sus órdenes)
create or replace function register_work_update(p_work integer, p_note text, p_progress integer, p_status work_status, p_camera_ok boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare w work_orders; me text; kind text; cn text; prev_status work_status; r user_role := app_role();
begin
  if r is null or r not in ('admin','cuadrilla') then raise exception 'No tenés permiso para registrar avances'; end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'Escribí una nota del avance'; end if;
  select * into w from work_orders where id = p_work for update;
  if not found then raise exception 'La tarea no existe'; end if;
  if r = 'cuadrilla' then
    if w.team_id is distinct from my_team() then raise exception 'Esa orden no es de tu equipo'; end if;
    if p_status not in ('en_proceso','completado') then raise exception 'Solo podés marcar la orden como en proceso o terminada'; end if;
    if w.status = 'completado' and w.verified_at is not null then raise exception 'La orden ya fue verificada'; end if;
    p_camera_ok := false;
  end if;
  prev_status := w.status;
  select name into me from people where user_id = auth.uid();
  kind := case when p_status = 'completado' and prev_status <> 'completado' then 'cierre'
               when prev_status = 'completado' and p_status <> 'completado' then 'reapertura' else 'avance' end;
  update work_orders set status = p_status,
      progress = case when p_status = 'completado' then 100 else greatest(0, least(100, p_progress)) end,
      completed_at = case when p_status = 'completado' then coalesce(completed_at, current_date) else null end,
      verified_at = case when p_status = 'completado' then verified_at else null end
    where id = p_work;
  insert into work_order_updates(work_order_id, author_name, kind, note, progress, status)
    values (p_work, me, kind, trim(p_note), case when p_status = 'completado' then 100 else p_progress end, p_status);
  if kind = 'cierre' and p_camera_ok then update cameras set status = 'operativa' where id = w.camera_id and active; end if;
  if kind = 'cierre' then
    select '#' || id || ' ' || name into cn from cameras where id = w.camera_id;
    insert into alert_outbox(event_type, camera_id, work_id, subject, body) values ('work_done', w.camera_id, p_work,
      format('[Central de Monitoreo] Tarea #%s completada (cámara %s)', p_work, cn),
      format('La tarea #%s (%s) de la cámara %s fue completada por %s.%sComentario de cierre: %s%s%s%sVer panel: https://central-monitoreo-dashboard.vercel.app/admin',
             p_work, w.task_type, cn, coalesce(me,'la administración'), E'\n', trim(p_note), E'\n',
             case when w.team_id is not null then 'La operadora debe verificar que la cámara volvió a funcionar.' else '' end, E'\n'));
  end if;
end $$;

-- 7) Verificación por la operadora y reasignación por la administración
create or replace function verify_work(p_work integer, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare w work_orders; me text; cn text; r record;
begin
  if app_role() not in ('admin','tecnico') then raise exception 'Solo la operadora o la administración pueden verificar'; end if;
  select * into w from work_orders where id = p_work for update;
  if not found or w.team_id is null or w.status <> 'completado' or w.verified_at is not null then raise exception 'La orden no está esperando verificación'; end if;
  select name into me from people where user_id = auth.uid();
  select '#' || id || ' ' || name into cn from cameras where id = w.camera_id;
  if p_ok then
    update work_orders set verified_at = now(), verified_by = auth.uid(), verify_note = nullif(trim(p_note), '') where id = p_work;
    update cameras set status = 'operativa' where id = w.camera_id and active;
    insert into work_order_updates(work_order_id, author_name, kind, note, progress, status)
      values (p_work, me, 'verificacion', 'Verificado: la cámara funciona.' || coalesce(' ' || nullif(trim(p_note), ''), ''), 100, 'completado');
  else
    if coalesce(trim(p_note), '') = '' then raise exception 'Contá qué sigue fallando'; end if;
    update work_orders set status = 'en_proceso', progress = 70, completed_at = null, verified_at = null, overdue_notified_at = null where id = p_work;
    insert into work_order_updates(work_order_id, author_name, kind, note, progress, status)
      values (p_work, me, 'reapertura', 'Sigue con problemas: ' || trim(p_note), 70, 'en_proceso');
    for r in select email from team_contacts where team_id = w.team_id loop
      insert into alert_outbox(event_type, camera_id, work_id, subject, body, to_email) values ('work_reopened', w.camera_id, p_work,
        '[Central de Monitoreo] Orden #' || p_work || ' reabierta - cámara ' || cn,
        'La orden #' || p_work || ' (' || w.task_type || ') de la cámara ' || cn || ' fue reabierta: la cámara sigue con problemas.' || E'\n\n' || 'Detalle: ' || trim(p_note) || E'\n\n' ||
        'Ingresá al panel, entrá a "Mantenimiento" y retomala: https://central-monitoreo-dashboard.vercel.app/admin', r.email);
    end loop;
    insert into alert_outbox(event_type, camera_id, work_id, subject, body) values ('work_reopened', w.camera_id, p_work,
      '[Central de Monitoreo] Orden #' || p_work || ' reabierta - cámara ' || cn,
      'La operadora ' || coalesce(me, '') || ' informó que la cámara ' || cn || ' sigue con problemas tras la orden #' || p_work || ': ' || trim(p_note));
  end if;
end $$;

create or replace function reassign_work(p_work integer, p_team text) returns void
language plpgsql security definer set search_path = public as $$
declare tn text; st work_status;
begin
  if app_role() <> 'admin' then raise exception 'Solo la administración puede reasignar'; end if;
  select name into tn from teams where id = p_team;
  if not found then raise exception 'El equipo no existe'; end if;
  select status into st from work_orders where id = p_work;
  if not found then raise exception 'La orden no existe'; end if;
  update work_orders set team_id = p_team, assignee = tn, verified_at = null where id = p_work;
  insert into work_order_updates(work_order_id, author_name, kind, note, status)
    values (p_work, (select name from people where user_id = auth.uid()), 'avance', 'Reasignada a ' || tn, st);
end $$;

revoke execute on function derive_work_from_entry(), notify_team_order(), notify_overdue_works() from public, anon, authenticated;
revoke execute on function verify_work(integer, boolean, text), reassign_work(integer, text) from public, anon;
grant execute on function verify_work(integer, boolean, text), reassign_work(integer, text) to authenticated;
