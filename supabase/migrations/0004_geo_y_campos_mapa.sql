create extension if not exists postgis with schema extensions;

-- Un contrato EPE pertenece a una sola cámara (opcional)
alter table cameras add constraint cameras_epe_contract_unique unique (epe_contract_id);

alter table cameras
  add column zone text,
  add column azimuth_deg smallint check (azimuth_deg between 0 and 359),
  add column fov_deg smallint check (fov_deg between 1 and 360),
  add column range_m smallint check (range_m > 0),
  add column mount_height_m numeric(4,1),
  add column mount_type text,
  add column link_type text,
  add column power_source text,
  add column photo_url text,
  add column coords_source text check (coords_source in ('gps','mapa','geocodificada','estimada')),
  add column coords_verified boolean not null default false,
  add column geom extensions.geography(Point,4326)
    generated always as (
      case when lat is not null and lng is not null
        then extensions.st_setsrid(extensions.st_makepoint(lng::float8, lat::float8), 4326)::extensions.geography
      end) stored;

create index cameras_geom_idx on cameras using gist (geom);
create index cameras_status_idx on cameras (status) where active;
create index work_orders_camera_idx on work_orders (camera_id);
create index logbook_camera_idx on logbook (camera_id, date desc);

create or replace view public_cameras as
  select id, name, model, camera_type, function, address, status, priority, last_review_at, notes,
         lat, lng, azimuth_deg, fov_deg, range_m, zone
  from cameras where active;
