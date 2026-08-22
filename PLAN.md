# Panel de la Central de Monitoreo

Proyecto independiente para visualizar el funcionamiento de la Central de
Monitoreo de la Municipalidad de San José de la Esquina. Se publicará en
Vercel y leerá en vivo la planilla de Google Sheets ya publicada.

## Objetivo

Construir un tablero público, responsive y de lectura rápida que conserve la
identidad visual del panel RSU —logo municipal, tipografía Nunito, paleta,
tarjetas, gráficos, tablas y temas claro/oscuro— sin compartir código, datos,
configuración ni repositorio con RSU.

## Fuente de datos

- Documento: `Seguimiento_Central_Monitoreo.xlsx`
- URL pública: <https://docs.google.com/spreadsheets/d/e/2PACX-1vQ7MaaihiDPem8QW7PEywjw2OAwXBQS3TJDNLzZXGRiWawU0XR1TVK9oe8mVrXmlw/pubhtml>
- Dashboard: `gid=991696568`
- Cámaras: `gid=1988961508`
- Trabajos: `gid=585065282`
- Bitácora: `gid=1024327547`
- KPI Histórico: `gid=1553361675`
- Instrucciones: `gid=2014469346`

El sitio consultará directamente las pestañas operativas en CSV. No será
necesario volver a desplegar cuando cambien los datos; bastará con actualizar
la página.

## Alcance de la primera versión

### Encabezado y filtros

- Logo oficial y estilo visual compartido con RSU.
- Título “Central de Monitoreo Municipal”.
- Estado de conexión, última actualización y botón para recargar.
- Tema claro/oscuro.
- Filtros por estado, prioridad, responsable, tipo de tarea y período.

### Indicadores principales

- Total de cámaras registradas.
- Cámaras operativas.
- Cámaras sin instalar.
- Cámaras con problemas o que requieren atención.
- Porcentaje de cobertura operativa.
- Total de trabajos.
- Trabajos completados, en proceso, no iniciados y demorados/vencidos.
- Avance promedio de los trabajos activos.

### Visualizaciones

- Distribución de cámaras por estado.
- Cámaras por prioridad.
- Evolución histórica de cobertura y estado del sistema.
- Trabajos por estado y tipo.
- Carga de trabajo por responsable.
- Tareas vencidas o próximas a vencer.

### Paneles operativos

- Inventario buscable y ordenable de cámaras.
- Semáforo visual de criticidad y prioridad.
- Plan de trabajos con avance, responsable y vencimiento.
- Últimas intervenciones de la bitácora.
- Detalle de cada cámara relacionando inventario, tareas y bitácora mediante
  `CAM ID`.

## Tratamiento y calidad de datos

El lector de la planilla será tolerante a mayúsculas, acentos, espacios y
variantes de estado. Antes de calcular los KPI normalizará, por ejemplo,
`ok`, `instalada`, `falta red`, `sin instalar`, `mantenimiento` y `falla`.

También deberá:

- ignorar filas vacías y textos de totales;
- validar fechas en distintos formatos;
- marcar fechas imposibles sin detener la carga;
- calcular los indicadores desde las hojas fuente, no desde las celdas
  resumidas del Dashboard;
- mostrar una advertencia discreta ante registros incompletos o incoherentes;
- evitar exponer las direcciones IP en la vista pública por seguridad.

## Observaciones encontradas en la planilla

- La portada publicada indica “Cruz Alta, Córdoba”; debe confirmarse y
  reemplazarse por “San José de la Esquina” si corresponde.
- Los totales resumidos no coinciden completamente entre la portada y el pie
  del inventario, por lo que el tablero recalculará todo desde las filas.
- Hay fechas aparentemente erróneas, como `06/05/0226` y `18/06/20206`.
- Algunos estados y textos tienen variantes o errores de escritura.
- La columna IP contiene información de infraestructura que conviene omitir
  del sitio público.

## Arquitectura propuesta

Sitio estático en HTML, CSS y JavaScript, siguiendo el enfoque probado en
RSU. Tendrá gráficos SVG propios, sin backend ni base de datos y sin exponer
credenciales. Se agregará `vercel.json` para el despliegue y encabezados de
seguridad básicos.

Estructura prevista:

```text
Central-Monitoreo-Dashboard/
├── index.html
├── css/styles.css
├── js/app.js
├── assets/logo-san-jose-de-la-esquina.svg
├── vercel.json
├── README.md
└── PLAN.md
```

## Etapas de implementación

1. Crear la base visual reutilizando únicamente la identidad y los patrones
   de interfaz de RSU.
2. Implementar la descarga y el parseo independiente de las cuatro hojas de
   datos.
3. Normalizar estados, fechas, porcentajes y relaciones por `CAM ID`.
4. Construir KPI, gráficos, filtros, tablas y vistas de detalle.
5. Probar estados vacíos, errores de red, datos inválidos, escritorio y móvil.
6. Preparar un repositorio Git independiente y configurar Vercel.
7. Validar los resultados contra la planilla antes de publicar.

## Criterios de aceptación

- El proyecto no modifica ni depende de archivos internos de RSU.
- Los cambios en Google Sheets aparecen al recargar el tablero.
- Los KPI se obtienen de los registros fuente y son trazables.
- La interfaz funciona correctamente en celular y computadora.
- Los errores de datos o conexión se explican sin dejar la página inutilizable.
- La versión pública no muestra direcciones IP ni información técnica sensible.
