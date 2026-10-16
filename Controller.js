/**
 * Controller.gs — punto de entrada. Compone dependencias y expone la API que
 * llama el frontend con google.script.run. Las funciones api* NO terminan en "_"
 * (las que terminan en "_" son privadas y el cliente no puede invocarlas).
 *
 * No hay doPost/JSON API todavía: se agrega en la fase PWA junto con la autenticación.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Trabajos de mantenimiento')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Raíz de composición: el ÚNICO lugar que elige los adaptadores concretos (Sheets, Drive,
 * LockService). Para migrar de motor o de servidor se cambia acá qué adaptador se instancia.
 */
function container_() {
  const cs = new ScriptLockCriticalSection();
  const catalogRepo = tab => new SheetCatalogRepository(new SheetRepository(tab, Config.CATALOG_FORMATS));
  const equipos = new CatalogService(catalogRepo(Config.TAB_EQUIPOS), cs, 'equipo');
  const personal = new CatalogService(catalogRepo(Config.TAB_PERSONAL), cs, 'persona');
  const trabajosRepo = new SheetTrabajoRepository(
    new SheetRepository(Config.TAB_TRABAJOS, Config.TRABAJOS_FORMATS, Config.COL.ID));
  return {
    trabajos: new TrabajoService(
      trabajosRepo,
      new TrabajoValidator(equipos, personal, new ImageValidator()),
      new DriveStorage(() => Config.folderId),
      cs
    ),
    busqueda: new TrabajoSearch(trabajosRepo, equipos, personal),
    catalogs: { equipos: equipos, personal: personal }
  };
}

function run_(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, error: 'Error interno: ' + (err && err.message ? err.message : err) };
  }
}

function catalog_(kind) {
  const c = container_().catalogs[kind];
  if (!c) throw new ValidationError('Catálogo inválido');
  return c;
}

function apiBootstrap() {
  return run_(() => {
    const c = container_().catalogs;
    return { equipos: c.equipos.activeNames(), personal: c.personal.activeNames() };
  });
}

function apiCrearTrabajo(payload) {
  return run_(() => container_().trabajos.create(payload));
}

function apiBuscarTrabajos(criterios) {
  return run_(() => container_().busqueda.search(criterios));
}

function apiCatalogoListar(kind) {
  return run_(() => catalog_(kind).list());
}

function apiCatalogoAgregar(kind, nombre) {
  return run_(() => catalog_(kind).add(nombre));
}

function apiCatalogoRenombrar(kind, id, nombre) {
  return run_(() => catalog_(kind).rename(id, nombre));
}

function apiCatalogoActivar(kind, id, activo) {
  return run_(() => catalog_(kind).setActive(id, activo));
}