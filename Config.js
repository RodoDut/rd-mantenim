/*
Trabajos de mantenimiento - Web App (Apps Script + Google Sheets)

Arquitectura de puertos y adaptadores:
Controller -> Servicios -> Puertos (Ports) -> Adaptadores (Sheets, Drive, LockService).
Frontend sin acceso a datos (index.html).

Documentacion completa (problema, arquitectura, decisiones tecnicas, modelo de datos,
pruebas y puesta en marcha): README.md del repositorio, https://github.com/RodoDut/rd-mantenim
El editor de Apps Script no admite archivos de documentacion, por eso este resumen.
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