alter function touch_updated_at() set search_path = public;
revoke execute on function app_role() from public, anon;
grant execute on function app_role() to authenticated;
revoke execute on function audit_row() from public, anon, authenticated;
