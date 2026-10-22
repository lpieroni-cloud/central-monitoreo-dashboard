-- Cada destinatario puede recibir o no los mails que nacen de las actas (cierre de acta y solicitudes de intervención).
alter table alert_recipients add column receives_actas boolean not null default true;
-- Registro de a quién se envió cada aviso
alter table alert_outbox add column sent_to text;
-- Período de aprendizaje: el intendente no recibe mails de actas por ahora (se reactiva desde el panel)
update alert_recipients set receives_actas = false where email = 'ezequielruani@gmail.com';
