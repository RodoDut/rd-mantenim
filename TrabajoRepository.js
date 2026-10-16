/**
 * TrabajoRepository.gs — adaptador del puerto TrabajoRepository para Google Sheets.
 * Es el ÚNICO lugar que conoce los encabezados de la pestaña de trabajos (Config.COL), el
 * formato de las celdas y la estrategia de ID (UUID en la columna "ID", asignado acá). Habla con la
 * planilla a través de SheetRepository (que es el único que toca SpreadsheetApp).
 */
class TimestampId {
  /**
   * La marca temporal es creadoEn, ya NO el ID de la orden: esto solo evita dos cargas con el mismo
   * segundo. Devuelve el primer segundo >= now que no esté en `taken`.
   * @param {Date} now
   * @param {Set<string>} taken marcas ya usadas, en formato Dates.iso()
   * @returns {Date}
   */
  static allocate(now, taken) {
    let ts = Dates.round(now);
    while (taken.has(Dates.iso(ts))) ts = new Date(ts.getTime() + 1000);
    return ts;
  }
}

class SheetTrabajoRepository {
  /** @param {{findAll:function():Object[], firstColumn:function():string[], insert:function(Object), assertHeaders:function(string[])}} sheet */
  constructor(sheet) {
    this.sheet = sheet;
  }

  /** Registro de planilla (claves = encabezados, fechas ya serializadas) -> entidad Trabajo. */
  static fromRow(r) {
    const C = Config.COL;
    const s = v => String(v == null ? '' : v);
    const creadoEn = s(r[C.TS]);
    return {
      // Transitorio: una fila sin ID (cargada fuera de la app, p. ej. por el Form) usa la marca
      // temporal hasta que corra migrarIds(). Leer nunca escribe en la planilla.
      id: s(r[C.ID]) || creadoEn,
      creadoEn,
      fecha: Dates.normalizeDay(r[C.FECHA]),
      equipo: s(r[C.EQUIPO]),
      personal: s(r[C.PERSONAL]).split(',').map(n => Text.clean(n)).filter(Boolean),
      descripcion: s(r[C.DESC]),
      imagenUrl: s(r[C.IMG])
    };
  }

  /** NuevoTrabajo + marca temporal + ID -> registro a escribir (con Date reales). */
  static toRow(nuevo, ts, id) {
    const C = Config.COL;
    const row = {};
    row[C.TS] = ts;
    row[C.EQUIPO] = nuevo.equipo;
    row[C.FECHA] = Dates.parseDay(nuevo.fecha);
    row[C.PERSONAL] = nuevo.personal.join(', ');
    row[C.DESC] = nuevo.descripcion;
    row[C.IMG] = nuevo.imagenUrl || '';
    row[C.ID] = id;
    return row;
  }

  /** Falla si la planilla no tiene los encabezados esperados (lo usa setup). */
  assertSchema() {
    this.sheet.assertHeaders(Object.values(Config.COL));
  }

  create(nuevo) {
    const taken = new Set(this.sheet.firstColumn().map(String));
    const ts = TimestampId.allocate(nuevo.creadoEn, taken);
    const id = Utilities.getUuid();
    this.sheet.insert(SheetTrabajoRepository.toRow(nuevo, ts, id));
    return {
      id,
      creadoEn: Dates.iso(ts),
      fecha: nuevo.fecha,
      equipo: nuevo.equipo,
      personal: nuevo.personal.slice(),
      descripcion: nuevo.descripcion,
      imagenUrl: nuevo.imagenUrl || ''
    };
  }

  search(criteria) {
    return TrabajoQuery.run(this._all(), criteria);
  }

  distinctValues() {
    const eq = new Map(), pe = new Map();
    const put = (map, name) => {
      const k = Text.key(name);
      if (k && !map.has(k)) map.set(k, Text.clean(name));
    };
    this._all().forEach(t => {
      put(eq, t.equipo);
      t.personal.forEach(n => put(pe, n));
    });
    return { equipos: Array.from(eq.values()), personal: Array.from(pe.values()) };
  }

  _all() {
    return this.sheet.findAll().map(r => SheetTrabajoRepository.fromRow(r));
  }
}