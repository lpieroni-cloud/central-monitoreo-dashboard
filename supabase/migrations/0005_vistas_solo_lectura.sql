-- Las vistas heredaban permisos de escritura por defecto de Supabase: solo lectura para anon.
revoke all on public_cameras, public_work_orders, public_logbook, public_kpi from anon, authenticated;
grant select on public_cameras, public_work_orders, public_logbook, public_kpi to anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
