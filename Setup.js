/**
 * Setup.gs — funciones que se ejecutan A MANO desde el editor (no desde la web app).
 *
 * Orden en el entorno de prueba:
 *   1) crearCarpetaDePrueba()  -> crea la carpeta de fotos de prueba y guarda FOLDER_ID
 *   2) cargar SPREADSHEET_ID en Script Properties (a mano)
 *   3) setup()                 -> valida la planilla y crea/siembra Equipos y Personal
 * setup() es idempotente: no duplica ni pisa catálogos que ya tienen datos.
 */

const EQUIPOS_INICIALES = [
  'Estiradora', 'Flejadora', 'Planchadora 1', 'Planchadora 2', 'Rayadora',
  'Puente Grúa 1', 'Puente Grúa 2', 'Puente Grúa 3',
  'Compresor 1', 'Compresor 2', 'Generador Principal',
  'Iluminación', 'Instalación Eléctrica', 'Camiones', 'Oficinas', 'Naves'
];

const PERSONAL_INICIAL = [
  'Ana García', 'Bruno López', 'Carla Gomez',
  'Diego Pérez', 'Elena Ruiz', 'Fabián Torres'
];

function crearCarpetaDePrueba() {
  const folder = DriveApp.createFolder('Fotos mantenimiento - PRUEBA');
  PropertiesService.getScriptProperties().setProperty('FOLDER_ID', folder.getId());
  console.log('Carpeta creada: ' + folder.getUrl());
}

function setup() {
  const trabajos = new SheetTrabajoRepository(new SheetRepository(Config.TAB_TRABAJOS, Config.TRABAJOS_FORMATS));
  trabajos.assertSchema(); // lanza si la planilla no es la esperada

  seedCatalog_(Config.TAB_EQUIPOS, EQUIPOS_INICIALES);
  seedCatalog_(Config.TAB_PERSONAL, PERSONAL_INICIAL);

  const folder = DriveApp.getFolderById(Config.folderId); // lanza si el id es inválido o sin acceso
  console.log('Carpeta de fotos OK: ' + folder.getName());
  console.log('Setup completo.');
}

function seedCatalog_(tab, names) {
  const repo = new SheetCatalogRepository(new SheetRepository(tab, Config.CATALOG_FORMATS));
  const added = repo.seed(names);
  console.log(added
    ? '"' + tab + '": ' + added + ' registros cargados.'
    : '"' + tab + '" ya tiene datos: no se siembra.');
}

/**
 * SOLO LECTURA. Muestra el estado de la columna ID de la pestaña de trabajos y el rango exacto
 * que escribiría migrarIds(). Correr siempre antes de migrarIds().
 */
function diagnosticoIds() {
  const repo = new SheetRepository(Config.TAB_TRABAJOS, Config.TRABAJOS_FORMATS, Config.COL.ID);
  const r = repo.inspectColumn(Config.COL.ID);
  console.log('Pestaña "' + Config.TAB_TRABAJOS + '": ' + r.rows + ' filas con datos.');
  console.log(r.exists
    ? 'Columna ID existente (n.º ' + r.column + '). Filas sin ID: ' + r.empty +
      '. IDs duplicados: ' + (r.duplicates.length ? r.duplicates.join(', ') : 'ninguno')
    : 'La columna ID NO existe.');
  if (!r.exists || r.empty) {
    console.log('migrarIds() escribiría: ' +
      (r.exists ? '' : 'encabezado "' + Config.COL.ID + '" en la columna ' + Config.TRABAJOS_ID_COLUMNA + ' (fila 1); ') +
      'UUID (texto) en ' + r.empty + ' celdas de la columna ' + (r.column || Config.TRABAJOS_ID_COLUMNA) +
      ', filas 2 a ' + (repo.count() + 1) + '. No toca las demás columnas ni otras pestañas.');
  } else {
    console.log('Nada para migrar.');
  }
}

/**
 * ESCRIBE en la planilla. Idempotente: crea el encabezado "ID" si falta y completa SOLO las celdas
 * vacías; nunca cambia un ID existente. Correr únicamente después de revisar diagnosticoIds().
 */
function migrarIds() {
  const repo = new SheetRepository(Config.TAB_TRABAJOS, Config.TRABAJOS_FORMATS, Config.COL.ID);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const created = repo.ensureColumn(Config.COL.ID, Config.TRABAJOS_ID_COLUMNA);
    const filled = repo.fillEmpty(Config.COL.ID, () => Utilities.getUuid());
    console.log((created ? 'Encabezado "ID" creado. ' : 'El encabezado "ID" ya existía. ') + filled + ' IDs asignados.');
    const r = repo.inspectColumn(Config.COL.ID);
    console.log('Verificación: filas sin ID: ' + r.empty + ' | duplicados: ' + (r.duplicates.length || 'ninguno'));
  } finally {
    lock.releaseLock();
  }
}