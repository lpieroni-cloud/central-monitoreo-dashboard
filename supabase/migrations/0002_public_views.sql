-- Vistas públicas de solo lectura. Sin IP, MAC, serial, contrato EPE ni IPs en texto libre.
-- Son SECURITY DEFINER a propósito: anon no tiene acceso a las tablas base, solo a estas vistas.

create view public_cameras as
  select id, name, model, camera_type, function, address, status, priority, last_review_at, notes
  from cameras where active;

create view public_work_orders as
  select w.id, w.camera_id, w.task_type, w.start_date, w.due_date, w.status, w.progress, w.assignee,
         regexp_replace(coalesce(w.notes,''), '\m(\d{1,3}\.){3}\d{1,3}\M', '[IP oculta]', 'g') as notes
  from work_orders w join cameras c on c.id = w.camera_id and c.active;

create view public_logbook as
  select l.id, l.date, l.camera_id, l.technician, l.type,
         regexp_replace(l.description, '\m(\d{1,3}\.){3}\d{1,3}\M', '[IP oculta]', 'g') as description,
         regexp_replace(coalesce(l.result,''), '\m(\d{1,3}\.){3}\d{1,3}\M', '[IP oculta]', 'g') as result,
         regexp_replace(coalesce(l.next_action,''), '\m(\d{1,3}\.){3}\d{1,3}\M', '[IP oculta]', 'g') as next_action
  from logbook l;

create view public_kpi as
  select week_label, date, operativas, sin_instalar, con_problema, trabajos_completados, trabajos_en_proceso, coverage
  from kpi_snapshots;

grant select on public_cameras, public_work_orders, public_logbook, public_kpi to anon, authenticated;
