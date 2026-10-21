# Sitio público (archivado)

El sitio público se dio de baja el 20/10/2026. La dirección principal lleva ahora al panel de ingreso.
Esta carpeta NO se publica (ver `.vercelignore`).

## Cómo retomarlo
1. Mover `index.html` a la raíz del proyecto y `js/app.js` a `js/app.js`.
2. Quitar la redirección de `/` en `vercel.json` y la línea `sitio-publico-archivado/` de `.vercelignore`.
3. Volver a dar lectura pública a las vistas en Supabase:
   `grant select on public_cameras, public_work_orders, public_logbook, public_kpi to anon;`
4. Revisar que las vistas públicas sigan ocultando IP, MAC, serie y contrato EPE (ver migraciones 0002 y 0006).
