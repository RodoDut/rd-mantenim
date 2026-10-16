/**
 * CatalogService.gs — catálogo con baja lógica (columna Activo). Sirve para Equipos y Personal.
 * Responsabilidad única: reglas de los catálogos (alta, renombrado, baja/reactivación, unicidad).
 * Depende de los puertos CatalogRepository y CriticalSection, no de Sheets.
 */
class CatalogService {
  /**
   * @param {{list:function():ItemCatalogo[], add:function(string):ItemCatalogo, update:function(string,Object)}} repo
   * @param {{run:function(function():*):*}} criticalSection
   * @param {string} label nombre singular para los mensajes ('equipo', 'persona')
   */
  constructor(repo, criticalSection, label) {
    this.repo = repo;
    this.criticalSection = criticalSection;
    this.label = label;
  }

  _items() { return this.repo.list(); }

  list() { return this._items(); }

  activeNames() { return this._items().filter(i => i.activo).map(i => i.nombre); }

  _name(raw) {
    const n = Text.clean(raw);
    if (!n) throw new ValidationError('El nombre es obligatorio');
    if (n.length > Config.MAX_NAME) throw new ValidationError('El nombre supera los ' + Config.MAX_NAME + ' caracteres');
    if (n.indexOf(',') !== -1) throw new ValidationError('El nombre no puede contener comas');
    return n;
  }

  _assertUnique(nombre, exceptId) {
    const dup = this._items().find(i => i.id !== exceptId && Text.key(i.nombre) === Text.key(nombre));
    if (!dup) return;
    throw new ValidationError(dup.activo
      ? '"' + dup.nombre + '" ya existe'
      : '"' + dup.nombre + '" ya existe pero está eliminado. Reactivalo desde la lista.');
  }

  _require(id) {
    const item = this._items().find(i => i.id === String(id));
    if (!item) throw new ValidationError('No se encontró el ' + this.label);
    return item;
  }

  add(raw) {
    const nombre = this._name(raw);
    this.criticalSection.run(() => {
      this._assertUnique(nombre, null);
      this.repo.add(nombre);
    });
    return this._items();
  }

  /** Renombra solo hacia adelante: los trabajos ya cargados guardan el texto original. */
  rename(id, raw) {
    const nombre = this._name(raw);
    this.criticalSection.run(() => {
      this._require(id);
      this._assertUnique(nombre, String(id));
      this.repo.update(String(id), { nombre: nombre });
    });
    return this._items();
  }

  /** "Eliminar" = Activo:false (se oculta de las listas, no se pierde historial). */
  setActive(id, activo) {
    if (typeof activo !== 'boolean') throw new ValidationError('Valor inválido');
    this.criticalSection.run(() => {
      this._require(id);
      this.repo.update(String(id), { activo: activo });
    });
    return this._items();
  }
}