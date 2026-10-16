/*
README.md
# Trabajos de mantenimiento — Web App (Apps Script + Sheets)

Arquitectura de puertos y adaptadores: `Controller -> Servicios -> Puertos (Ports.gs) -> Adaptadores (Sheets, Drive, LockService)`. Frontend sin acceso a datos (`index.html`).

Repositorio público de muestra de código (los datos y configuraciones reales no están incluidos). Este README también está copiado como comentario al inicio de `Config.gs`, porque el editor de Apps Script no admite archivos de documentación: si se cambia uno, actualizar el otro.

## Puesta en marcha (ENTORNO DE PRUEBA, cuenta de Rodo)

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

## Modelo de datos (resumen)
- Pestaña `Trabajos_mantenimiento`: A–F son las columnas históricas del Form (A = `Marca temporal` = momento de carga, `creadoEn`), **G = `ID`** (UUID, lo asigna la app y no cambia nunca). El historial se ordena por fecha del trabajo y luego por `creadoEn`; el ID es opaco y no ordena nada.
- El Form queda **congelado** como respaldo histórico. Una fila cargada fuera de la app (sin ID) se sigue mostrando, con la marca temporal como ID transitorio, hasta que se corra `migrarIds`. Leer nunca escribe en la planilla.

## Pruebas locales (no se suben a Apps Script)
`node test/harness.js` desde la raíz del proyecto (62 pruebas, requiere Node; probado con 20.19). Incluye una suite de contrato que corre la lógica sin el código de Sheets/Drive.

## Pasar a producción
Copiar el proyecto a la cuenta de producción, cambiar `SPREADSHEET_ID` y `FOLDER_ID` en Script Properties, correr `diagnosticoIds` y `migrarIds` sobre la copia de la planilla original, ejecutar `setup`, implementar igual que arriba. Nunca se despliega a producción para probar un cambio: primero se prueba todo en la copia.
*/

/**
 * Config.gs — constantes, lectura de Script Properties y utilidades de fecha.
 * Propiedades requeridas (Configuración del proyecto > Propiedades del script):
 *   SPREADSHEET_ID  id de la planilla (copia de prueba o producción)
 *   FOLDER_ID       id de la carpeta de Drive donde se guardan las fotos
 */
const Config = {
  get spreadsheetId() { return Config._prop('SPREADSHEET_ID'); },
  get folderId() { return Config._prop('FOLDER_ID'); },

  _prop(name) {
    const v = PropertiesService.getScriptProperties().getProperty(name);
    if (!v) throw new Error('Falta la propiedad ' + name + ' en Script Properties');
    return v;
  },

  TAB_TRABAJOS: 'Trabajos_mantenimiento',
  TAB_EQUIPOS: 'Equipos',
  TAB_PERSONAL: 'Personal',

  // Encabezados EXACTOS de la pestaña de trabajos (compatibles con el Form).
  COL: {
    TS: 'Marca temporal',
    EQUIPO: 'Elegir equipo',
    FECHA: 'Elija Fecha',
    PERSONAL: 'Personal Interviniente',
    DESC: 'Descripción',
    IMG: 'Imagen asociada',
    ID: 'ID' // UUID asignado por la app (clave sustituta). 'Marca temporal' es solo creadoEn.
  },

  // Posición (base 1) de la columna ID en la pestaña de trabajos: G. Solo la usa migrarIds().
  TRABAJOS_ID_COLUMNA: 7,

  CATALOG_HEADERS: ['ID', 'Nombre', 'Activo'],

  MAX_IMG_BYTES: 10 * 1024 * 1024,
  MAX_DESC: 2000,
  MAX_NAME: 60,
  MAX_PERSONAL: 15,

  // Búsqueda
  PAGE_SIZE: 30,
  MAX_PAGE: 50,
  MAX_QUERY: 100,
  MAX_FILTER_PERSONAL: 50
};

// Formatos de celda por encabezado: fechas reales y texto plano ('@') para que
// ningún texto cargado se interprete como fórmula.
Config.TRABAJOS_FORMATS = {
  [Config.COL.TS]: 'dd/MM/yyyy H:mm:ss',
  [Config.COL.EQUIPO]: '@',
  [Config.COL.FECHA]: 'dd/MM/yyyy',
  [Config.COL.PERSONAL]: '@',
  [Config.COL.DESC]: '@',
  [Config.COL.IMG]: '@',
  [Config.COL.ID]: '@'
};
Config.CATALOG_FORMATS = { Nombre: '@' };

const Dates = {
  tz() { return Session.getScriptTimeZone(); },

  // Redondea al segundo: los Date que vienen de Sheets pueden traer ruido de coma flotante.
  round(d) { return new Date(Math.round(d.getTime() / 1000) * 1000); },

  iso(d) { return Utilities.formatDate(Dates.round(d), Dates.tz(), "yyyy-MM-dd'T'HH:mm:ss"); },
  day(d) { return Utilities.formatDate(d, Dates.tz(), 'yyyy-MM-dd'); },
  stamp(d) { return Utilities.formatDate(d, Dates.tz(), 'yyyyMMdd_HHmmss'); },

  // Normaliza una fecha ya serializada a 'yyyy-MM-dd'. Acepta ISO ('2026-10-12T00:00:00')
  // y texto 'd/M/yyyy' (por si alguna fila antigua quedó como texto). Devuelve '' si no la entiende.
  normalizeDay(v) {
    const s = String(v == null ? '' : v).trim();
    let m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (m) return m[1];
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (!m) return '';
    const p = n => (n.length < 2 ? '0' + n : n);
    return m[3] + '-' + p(m[2]) + '-' + p(m[1]);
  },

  // 'yyyy-MM-dd' -> Date a medianoche en la zona del script, o null si no es una fecha real.
  parseDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    const d = new Date(y, mo - 1, da);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d;
  }
};