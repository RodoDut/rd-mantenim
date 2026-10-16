/**
 * CatalogRepository.gs — adaptador del puerto CatalogRepository para Google Sheets.
 * Conoce las columnas ID / Nombre / Activo y genera el ID (UUID). Sirve para Equipos y Personal.
 */
class SheetCatalogRepository {
  /** @param {{findAll:function():Object[], insert:function(Object), updateById:function(string,Object)}} sheet */
  constructor(sheet) {
    this.sheet = sheet;
  }

  list() {
    return this.sheet.findAll().map(r => ({
      id: String(r.ID),
      nombre: String(r.Nombre),
      activo: r.Activo === true || String(r.Activo).toUpperCase() === 'TRUE'
    }));
  }

  add(nombre) {
    const id = Utilities.getUuid();
    this.sheet.insert({ ID: id, Nombre: nombre, Activo: true });
    return { id: id, nombre: nombre, activo: true };
  }

  update(id, patch) {
    const row = {};
    if (patch.nombre !== undefined) row.Nombre = patch.nombre;
    if (patch.activo !== undefined) row.Activo = patch.activo;
    this.sheet.updateById(String(id), row);
  }

  /**
   * Crea la pestaña si no existe y la siembra si está vacía (lo usa setup). Idempotente.
   * @param {string[]} names
   * @returns {number} cantidad de registros cargados (0 si ya tenía datos)
   */
  seed(names) {
    const created = this.sheet.ensureTab(Config.CATALOG_HEADERS);
    if (!created && this.sheet.count() > 0) return 0;
    this.sheet.insertMany(names.map(n => ({ ID: Utilities.getUuid(), Nombre: n, Activo: true })));
    return names.length;
  }
}