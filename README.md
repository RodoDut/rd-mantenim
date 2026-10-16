# Trabajos de mantenimiento — Web App (Apps Script + Google Sheets)

Sistema de gestión de mantenimiento industrial basado en el **registro de los trabajos de mantenimiento sobre los equipos e instalaciones de una planta**. Es una aplicación web que usa **Google Sheets como base de datos** y **Google Drive para las fotos**, y corre íntegramente sobre Google Apps Script (V8), sin servidores propios y sin dependencias externas.

> Repositorio público de muestra de código: los datos, cuentas y configuraciones reales no están incluidos. Los nombres de personas y equipos de `Setup.js` y de los tests son de ejemplo.

## Qué problema resuelve

En una planta industrial, lo que no queda registrado no se puede mejorar. Cada intervención sobre una máquina o instalación (reparación, ajuste, revisión, cambio de repuesto) es información valiosa que, si no se guarda de forma ordenada, se pierde en la memoria de quien la hizo. Sin ese historial no hay forma de saber en qué estado está cada equipo, qué mantenimiento se le debe ni cuánto tiempo estuvo parado.

El objetivo del sistema es dar al equipo de mantenimiento y a la planta una **visión clara y actualizada de dos cosas**:

- **El estado de las tareas de mantenimiento:** abiertas, pendientes, cerradas, finalizadas.
- **El estado de cada equipo:** operativo, no operativo, con el mantenimiento preventivo vencido, tiempos de parada (*downtime*), entre otros indicadores.

Con eso se puede **minimizar las paradas de producción**, anticiparse a las fallas en lugar de reaccionar y **optimizar el trabajo del propio equipo de mantenimiento** (cómo se reparte la carga, qué tareas se repiten, dónde se va el tiempo).

Todo ello descansa en un cimiento que sí existe hoy: un **registro diario de trabajos, rápido de cargar desde el celular, validado y con identificador propio por registro**. Esta aplicación es la versión mejorada de una carga por Google Form que permitió la primera adquisición de datos; agrega consulta del historial, catálogos editables y una base de datos preparada para crecer.

## Estado del proyecto

| | |
|---|---|
| **Implementado** | Registro de trabajos (con foto), historial con búsqueda y filtros, administración de equipos y personal, ID único por registro, pruebas automáticas. |
| **Corto plazo** | Estado de cada tarea (abierta, pendiente, cerrada, finalizada), tipo de trabajo, fecha de cierre y última modificación; estado de cada equipo (operativo / no operativo, preventivo vencido) y tiempos de *downtime*. |
| **Más adelante** | Edición con auditoría, indicadores, usuarios identificados y base de datos relacional. |

## Qué hace hoy

Tres vistas en una interfaz *mobile-first*:

| Vista | Función |
|---|---|
| **Cargar** | Alta de un trabajo: equipo (lista), fecha, personal interviniente (chips + "otro" eventual), descripción (hasta 2000 caracteres) y foto opcional. |
| **Historial** | Búsqueda combinable por texto libre, equipo, rango de fechas y personal (coincide con *alguno* o con *todos* los elegidos), con paginado ("Cargar más"). |
| **Configuración** | Alta, renombrado y baja lógica de equipos y personas, sin tocar código ni la planilla. Las bajas no borran datos: los trabajos viejos conservan su nombre. |

## Cómo está hecho

### Arquitectura: puertos y adaptadores

La lógica de negocio no sabe que existe Google Sheets. Habla con *puertos* (contratos definidos en `Ports.js`) y los adaptadores concretos se eligen en un único lugar, la raíz de composición (`Controller.js`).

```
index.html (frontend, sin acceso a datos)
   │  google.script.run
   ▼
Controller.js  ── raíz de composición: elige los adaptadores ──────────────┐
   │                                                                       │
   ▼                                                                       ▼
Servicios (reglas de negocio)                         Adaptadores (infraestructura)
  TrabajoService    alta: validar → foto → guardar      SheetTrabajoRepository / SheetCatalogRepository
  TrabajoSearch     filtros del historial               SheetRepository  ← único que toca SpreadsheetApp
  CatalogService    equipos y personal                  DriveStorage     ← único que toca DriveApp
  TrabajoValidator  validación y normalización          ScriptLockCriticalSection (LockService)
   │
   ▼
Puertos (Ports.js): TrabajoRepository · CatalogRepository · FileStorage · CriticalSection
```

Consecuencia práctica: migrar a otro motor (SQL, otro servidor) es **escribir adaptadores nuevos**, no tocar servicios ni reglas. Los tests lo demuestran corriendo la capa de negocio con adaptadores en memoria.

### Decisiones técnicas

- **Identificador estable (UUID) en columna aparte.** Cada trabajo tiene un `ID` generado con `Utilities.getUuid()`, opaco y que nunca cambia. La `Marca temporal` original queda como `creadoEn` y es la que ordena el historial (fecha del trabajo desc → `creadoEn` desc → ID como desempate). Esto habilita referenciar registros y una futura migración relacional.
- **Compatibilidad con el Form histórico.** Las columnas A–F se respetan tal cual; el Form puede quedar congelado como respaldo. Una fila sin ID se muestra igual (con su marca temporal como ID transitorio) hasta correr `migrarIds`. **Leer nunca escribe.**
- **Migración segura de datos.** `diagnosticoIds` (solo lectura) informa exactamente qué se escribiría; `migrarIds` es idempotente, solo llena celdas vacías y nunca cambia un ID existente ni toca otras columnas.
- **Concurrencia.** Las escrituras corren dentro de `LockService` (puerto `CriticalSection`), liberado siempre, incluso con error. Los timestamps de alta se garantizan únicos.
- **Alta con foto transaccional.** Se sube la foto, se guarda la fila y, si el guardado falla, la foto va a la papelera (reversible). Nunca se borra nada de forma permanente.
- **Validación en el servidor, siempre.** El cliente no es de confianza: el equipo debe existir y estar activo, la fecha ser real y no futura, el personal acotado (máx. 15 personas de 60 caracteres) y la descripción obligatoria y acotada. Las comas en nombres se normalizan porque separan nombres en la celda.
- **Imágenes.** El navegador reduce la foto (lado máximo 1920 px, JPEG calidad 0,8) antes de enviarla; el servidor igualmente verifica el tamaño (≤ 10 MB) y **detecta el formato por los bytes** (JPG, PNG, WEBP) sin confiar en el tipo que informa el cliente.
- **Datos como texto plano.** Las columnas de texto se escriben con formato `@`, de modo que nada de lo cargado se interprete como fórmula; las fechas se guardan como fechas reales de Sheets, no como texto.
- **Búsqueda como funciones puras.** `TrabajoQuery` implementa filtrado, orden y paginado sin depender de Apps Script: es la especificación ejecutable del puerto `TrabajoRepository.search` (Sheets no filtra, así que se filtra en memoria; un adaptador SQL debe devolver los mismos resultados con un `WHERE`). La comparación ignora tildes y mayúsculas.
- **Superficie de API mínima.** El cliente solo puede invocar las funciones `api*` del controlador (las que terminan en `_` son privadas en Apps Script). Los errores de validación llegan al usuario con un mensaje claro; los inesperados se registran en el log y se informan como "Error interno".
- **Frontend sin `innerHTML`.** La interfaz arma el DOM con `createElement` y `textContent`, de modo que lo que se carga se muestra siempre como texto.

### Modelo de datos

Pestaña `Trabajos_mantenimiento`:

| Col. | Encabezado | Contenido |
|---|---|---|
| A | `Marca temporal` | Momento de carga (`creadoEn`). |
| B | `Elegir equipo` | Nombre canónico del catálogo. |
| C | `Elija Fecha` | Fecha del trabajo. |
| D | `Personal Interviniente` | Nombres separados por coma. |
| E | `Descripción` | Texto libre. |
| F | `Imagen asociada` | URL de la foto en Drive (opcional). |
| G | `ID` | UUID asignado por la app. |

Pestañas `Equipos` y `Personal`: `ID`, `Nombre`, `Activo` (baja lógica).

### Limitaciones conocidas (trade-offs asumidos)

- **Sheets no es una base de datos relacional.** El historial se lee completo y se filtra en memoria en cada consulta: está pensado para volúmenes moderados, no para millones de filas. Si el volumen crece, el siguiente paso es un adaptador SQL (el diseño ya lo contempla).
- **Identidad.** Se despliega como "Ejecutar como yo / acceso: solo yo", con una cuenta dedicada: no se sabe *quién* carga cada trabajo, solo qué personal participó. Un puerto de identidad es la evolución prevista.
- **Alcance actual.** Hoy la aplicación cubre el **registro y la consulta** de trabajos. El seguimiento de estados (de tareas y de equipos) y los indicadores de *downtime* son el siguiente paso (ver [Estado del proyecto](#estado-del-proyecto)); el modelo de datos ya está pensado para recibirlos. La edición de trabajos cargados, la auditoría y el backup automático también están pendientes.
- **Cuotas de Apps Script** (tiempo de ejecución, tamaño de respuesta, `LockService`) aplican; la paginación y el tope de resultados por página existen por eso.

## Pruebas

62 pruebas automáticas sin dependencias (solo Node, probado con 20.19) que cargan el código de Apps Script en un contexto simulado:

```
node test/harness.js
```

Incluyen una **suite de contrato** que ejecuta toda la lógica de negocio **sin** el código de Sheets ni de Drive y con adaptadores en memoria: si algún servicio dependiera de la infraestructura, fallaría. También cubren la migración de IDs, la concurrencia, el rollback de fotos y la validación.

## Estructura del repositorio

```
Controller.js        punto de entrada (doGet, api*) y raíz de composición
Ports.js             contratos de los puertos
TrabajoService.js    caso de uso: cargar un trabajo
TrabajoSearch.js     caso de uso: consultar el historial
TrabajoQuery.js      filtrado/orden/paginado (funciones puras)
TrabajoValidator.js  validación y normalización (incluye ImageValidator)
TrabajoMapper.js     entidad → DTO para el frontend
CatalogService.js    equipos y personal (alta, renombrado, baja lógica)
Repository.js        SheetRepository: único acceso a SpreadsheetApp
TrabajoRepository.js / CatalogRepository.js   adaptadores de Sheets
Storage.js           DriveStorage: único acceso a DriveApp
CriticalSection.js   adaptador de LockService
Common.js · Config.js   utilidades y configuración
Setup.js             funciones manuales: setup, diagnosticoIds, migrarIds
index.html           frontend (HTML/CSS/JS sin dependencias)
appsscript.json      manifiesto (V8, scopes, web app)
test/                harness y pruebas
```

## Puesta en marcha (ENTORNO DE PRUEBA)

1. script.google.com > Proyecto nuevo (independiente, no vinculado a la planilla). Nombre: `rd-mant (PRUEBA)`.
2. Cargar los 16 archivos de código (tipo Script): `Config`, `Common`, `Ports`, `CriticalSection`, `Repository`, `Storage`, `TrabajoRepository`, `CatalogRepository`, `TrabajoQuery`, `CatalogService`, `TrabajoMapper`, `TrabajoValidator`, `TrabajoSearch`, `TrabajoService`, `Controller`, `Setup`; y `index` (tipo HTML, nombre exacto `index`). Dos formas:
   - **Con clasp (recomendada):** activar la API de Google Apps Script en https://script.google.com/home/usersettings, instalar y autenticar (`npm install -g @google/clasp`, `clasp login`), y desde la raíz del proyecto `clasp push`. Copiar `.clasp.json.example` a `.clasp.json` y poner el `scriptId` del proyecto de prueba (el `.clasp.json` real no se versiona). El `.claspignore` deja afuera `test/`, los `.md` y `test.zip` (subir los tests rompería el proyecto: comparten el ámbito global).
   - **A mano:** pegar cada archivo en el editor. El orden no importa.
   No debe existir ningún `Service.gs` ni `Transaction.gs`: si quedó alguno de una versión anterior, borrarlo (duplica las clases y rompe todo).
3. Configuración del proyecto > marcar "Mostrar el archivo de manifiesto appsscript.json" y reemplazar su contenido por el de `appsscript.json` (con clasp ya viaja).
4. Configuración del proyecto > Propiedades del script: agregar `SPREADSHEET_ID` = id de la COPIA de prueba (el id está en la URL de la planilla).
5. Editor > ejecutar `crearCarpetaDePrueba` (autorizar permisos la primera vez). Crea la carpeta de fotos de prueba y guarda `FOLDER_ID`.
6. **Columna ID** (la pestaña de trabajos necesita la columna `ID` en G; `setup` falla si no está):
   1. Ejecutar `diagnosticoIds`. Es solo lectura: informa cuántas filas tienen datos, cuántas no tienen ID y el rango exacto que se escribiría.
   2. Revisar la salida (Ver > Registros de ejecución). Solo si coincide con lo esperado:
   3. Ejecutar `migrarIds`. Crea el encabezado `ID` en G y asigna un UUID (como texto) a las filas con datos que no lo tienen. Es idempotente: nunca cambia un ID existente ni toca las demás columnas.
7. Ejecutar `setup`. Valida encabezados, crea y siembra las pestañas `Equipos` y `Personal` con datos de ejemplo. Es idempotente.
8. Implementar > Nueva implementación > Aplicación web. Ejecutar como: **Yo**. Quién tiene acceso: **Solo yo**.


## Pasar a producción
Copiar el proyecto a la cuenta de producción, cambiar `SPREADSHEET_ID` y `FOLDER_ID` en Script Properties, correr `diagnosticoIds` y `migrarIds` sobre la copia de la planilla original, ejecutar `setup`, implementar igual que arriba. Nunca se despliega a producción para probar un cambio: primero se prueba todo en la copia.
