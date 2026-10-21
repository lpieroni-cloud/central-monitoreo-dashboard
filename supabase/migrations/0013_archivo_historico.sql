-- Archivo histórico: registros retirados del uso diario (por ejemplo, novedades y tareas
-- importadas de la planilla original y el acta de prueba N° 1), para poder consultarlos más adelante.
create table archive_records (
  id bigint generated always as identity primary key,
  archived_at timestamptz not null default now(),
  source_table text not null,
  source_id text,
  reason text,
  data jsonb not null
);
create index archive_records_source_idx on archive_records(source_table, archived_at);
create index archive_records_data_idx on archive_records using gin (data jsonb_path_ops);
alter table archive_records enable row level security;
create policy admin_read on archive_records for select to authenticated using (app_role() = 'admin');
revoke all on archive_records from anon, authenticated;
grant select on archive_records to authenticated;
