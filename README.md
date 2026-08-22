# Central de Monitoreo — San José de la Esquina

Tablero estático e independiente que lee en vivo el inventario de cámaras, el
plan de trabajos, la bitácora y el histórico de KPI desde Google Sheets.

## Uso local

Servir esta carpeta con un servidor HTTP, por ejemplo `npx serve .`, y abrir la
URL informada. No requiere instalación ni proceso de compilación.

## Publicación en Vercel

Importar esta carpeta como proyecto nuevo. Framework Preset: `Other`; Build
Command: vacío; Output Directory: `.`. Los cambios de la planilla aparecen al
recargar y no requieren un nuevo despliegue.

La interfaz pública omite deliberadamente la columna IP.
