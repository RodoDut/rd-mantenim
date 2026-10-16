/**
 * TrabajoQuery.gs — reglas de coincidencia, orden y paginación del historial, como funciones
 * PURAS sobre entidades Trabajo (sin Sheets, sin Drive, sin Apps Script). Es la especificación
 * ejecutable del puerto TrabajoRepository.search: el adaptador de Sheets la usa porque Sheets
 * no filtra; un adaptador SQL debe producir los mismos resultados con un WHERE.
 *
 * Orden: fecha del trabajo desc, luego creadoEn desc (cronológico) y, como desempate estable, id.
 * El ID es opaco (UUID): no ordena nada. Un adaptador SQL debe ordenar por creado_en.
 */
const TrabajoQuery = {
  /**
   * @param {Trabajo[]} trabajos
   * @param {CriteriosBusqueda} c
   * @returns {{total:number, items:Trabajo[]}}
   */
  run(trabajos, c) {
    const matched = trabajos.filter(t => TrabajoQuery.matches(t, c));
    matched.sort((a, b) =>
      TrabajoQuery.cmpDesc_(a.fecha, b.fecha) ||
      TrabajoQuery.cmpDesc_(a.creadoEn || '', b.creadoEn || '') ||
      TrabajoQuery.cmpDesc_(a.id, b.id));
    return { total: matched.length, items: matched.slice(c.offset, c.offset + c.limit) };
  },

  cmpDesc_(a, b) {
    return a < b ? 1 : a > b ? -1 : 0;
  },

  matches(t, c) {
    if (c.equipoKey && Text.key(t.equipo) !== c.equipoKey) return false;
    if (c.desde && !(t.fecha && t.fecha >= c.desde)) return false;
    if (c.hasta && !(t.fecha && t.fecha <= c.hasta)) return false;
    if (c.personalKeys.length) {
      const who = t.personal.map(n => Text.key(n)).filter(Boolean);
      const has = k => who.indexOf(k) !== -1;
      const pass = c.modo === 'all' ? c.personalKeys.every(has) : c.personalKeys.some(has);
      if (!pass) return false;
    }
    if (c.tokens.length) {
      const hay = Text.key([t.equipo, t.personal.join(', '), t.descripcion].join(' '));
      if (!c.tokens.every(tok => hay.indexOf(tok) !== -1)) return false;
    }
    return true;
  }
};