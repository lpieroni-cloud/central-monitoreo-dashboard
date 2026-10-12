alter table alert_outbox add column to_email text check (to_email is null or to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
