-- Correos que reciben las órdenes de cada equipo y plazo de "Sin energía eléctrica" ajustado a 48 h.
insert into team_contacts(team_id, email, name) values
  ('electrica', 'mantenimientocoemsje@gmail.com', 'Mantenimiento eléctrico'),
  ('sjvc', 'gaston_molinaro@hotmail.com', 'Gastón Molinaro');
update problem_types set due_hours = 48 where code = 'sin_energia';
