create or replace view public_cameras as
  select id, name, model, camera_type, function, address, status, priority, last_review_at,
         regexp_replace(coalesce(notes,''), '\m(\d{1,3}\.){3}\d{1,3}\M', '[IP oculta]', 'g') as notes,
         lat, lng, azimuth_deg, fov_deg, range_m, zone
  from cameras where active;
grant select on public_cameras to anon, authenticated;
