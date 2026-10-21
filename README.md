# Central de Monitoreo — San José de la Esquina

Panel de gestión de la Central de Monitoreo Municipal: estado de las cámaras, mapa, actas de turno,
tareas de mantenimiento, usuarios y avisos por mail. Sitio estático (HTML/CSS/JS) sobre Supabase.

- **Ingreso:** `/admin` (la dirección principal redirige ahí). Requiere usuario y contraseña.
- **Base de datos:** Supabase (migraciones versionadas en `supabase/migrations/`, funciones en `supabase/functions/`).
- **Hosting:** Vercel, con despliegue automático desde la rama `main`.
- **Sitio público:** dado de baja el 20/10/2026; archivado en `sitio-publico-archivado/` (ver su `LEEME.md` para retomarlo).

## Uso local
Servir esta carpeta con un servidor HTTP, por ejemplo `npx serve .`, y abrir `/admin`.
