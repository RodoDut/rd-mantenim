/**
 * TrabajoService.gs — caso de uso "cargar un trabajo". Solo orquesta:
 *   validar (TrabajoValidator) -> subir foto (FileStorage) -> guardar (TrabajoRepository, dentro de
 *   CriticalSection) -> si el guardado falla, la foto subida va a la papelera.
 * No contiene reglas de validación ni de consulta (TrabajoValidator, TrabajoSearch) y no conoce la
 * planilla: depende solo de los puertos descritos en Ports.gs.
 */
class TrabajoService {
  /**
   * @param {{create:function(NuevoTrabajo):Trabajo}} repo
   * @param {{validate:function(Object, Date):Object}} validator
   * @param {{save:function(...):{id:string,url:string}, trash:function(string)}} storage
   * @param {{run:function(function():*):*}} criticalSection
   * @param {function():Date} [now]
   */
  constructor(repo, validator, storage, criticalSection, now) {
    this.repo = repo;
    this.validator = validator;
    this.storage = storage;
    this.criticalSection = criticalSection;
    this.now = now || (() => new Date());
  }

  create(input) {
    const now = this.now();
    const data = this.validator.validate(input, now);
    const file = data.imagen ? this._upload(data, now) : null;
    try {
      return this.criticalSection.run(() => this._insert(data, file, now));
    } catch (err) {
      this._discard(file);
      throw err;
    }
  }

  _upload(data, now) {
    const name = Dates.stamp(now) + '_' + Text.slug(data.equipo) + '.' + data.imagen.ext;
    return this.storage.save(data.imagen.bytes, data.imagen.mime, name);
  }

  _discard(file) {
    if (!file) return;
    try {
      this.storage.trash(file.id);
    } catch (e) {
      console.error('No se pudo enviar a papelera ' + file.id + ': ' + e);
    }
  }

  _insert(data, file, now) {
    const created = this.repo.create({
      fecha: Dates.day(data.fecha),
      equipo: data.equipo,
      personal: data.personal,
      descripcion: data.descripcion,
      imagenUrl: file ? file.url : '',
      creadoEn: now
    });
    return TrabajoMapper.toDto(created);
  }
}