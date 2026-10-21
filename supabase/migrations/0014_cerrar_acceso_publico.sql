-- Baja del sitio público: las vistas públicas dejan de ser legibles sin iniciar sesión.
revoke all on public_cameras, public_work_orders, public_logbook, public_kpi from anon;
