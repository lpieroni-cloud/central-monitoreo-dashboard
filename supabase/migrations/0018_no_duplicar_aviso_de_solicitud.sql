-- Si el problema se deriva solo a un equipo, ya se avisa por la orden de trabajo: no se manda además la "solicitud de intervención".
create or replace function notify_action_request() returns trigger language plpgsql security definer set search_path = public as $$
declare cams text; s shifts; turno text;
begin
  if not new.needs_action or new.handled_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.needs_action then return new; end if;
  if new.problem_type is not null and exists (select 1 from problem_types where code = new.problem_type and team_id is not null) then return new; end if;
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
