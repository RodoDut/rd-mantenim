/**
 * TrabajoSearch.gs — caso de uso "consultar el historial": valida y normaliza los filtros y se los
 * pasa al repositorio (puerto TrabajoRepository.search). Solo lee. No sabe cómo se filtra ni dónde
 * están los datos: con Sheets filtra en memoria (TrabajoQuery); con SQL será un WHERE.
 */
class TrabajoSearch {
  /**
   * @param {{search:function(CriteriosBusqueda):{total:number,items:Trabajo[]}, distinctValues:function():{equipos:string[],personal:string[]}}} repo
   * @param {{list:function():ItemCatalogo[]}} equipos
   * @param {{list:function():ItemCatalogo[]}} personal
   */
  constructor(repo, equipos, personal) {
    this.repo = repo;
    this.equipos = equipos;
    this.personal = personal;
  }

  /**
   * Filtros (todos opcionales; se combinan con AND):
   *   equipo   nombre exacto (sin distinguir tildes ni mayúsculas)
   *   desde / hasta   rango inclusivo sobre la FECHA DEL TRABAJO, 'yyyy-MM-dd'
   *   personal + modo   lista de nombres; modo 'any' (alguno) o 'all' (todos)
   *   q        texto libre sobre equipo, personal y descripción; deben aparecer todas las palabras
   * Orden: fecha del trabajo desc, luego fecha de carga desc. Paginado con offset/limit.
   * Con withOptions:true devuelve además los valores disponibles para armar los filtros.
   */
  search(raw) {
    const c = this._criteria(raw);
    const page = this.repo.search(c);
    const result = {
      total: page.total,
      offset: c.offset,
      items: page.items.map(t => TrabajoMapper.toDto(t))
    };
    if (c.withOptions) result.opciones = this._options();
    return result;
  }

  _criteria(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    const day = (v, label) => {
      const s = String(v == null ? '' : v).trim();
      if (!s) return '';
      if (!Dates.parseDay(s)) throw new ValidationError('La fecha "' + label + '" no es válida');
      return s;
    };
    const desde = day(c.desde, 'desde');
    const hasta = day(c.hasta, 'hasta');
    if (desde && hasta && desde > hasta) throw new ValidationError('"Desde" no puede ser posterior a "hasta"');

    const personal = Array.isArray(c.personal) ? c.personal : [];
    if (personal.length > Config.MAX_FILTER_PERSONAL) throw new ValidationError('Demasiadas personas en el filtro');

    const q = Text.key(String(c.q == null ? '' : c.q).slice(0, Config.MAX_QUERY));
    return {
      equipoKey: Text.key(c.equipo),
      desde: desde,
      hasta: hasta,
      personalKeys: personal.map(p => Text.key(p)).filter(Boolean),
      modo: c.modo === 'all' ? 'all' : 'any',
      tokens: q ? q.split(' ') : [],
      offset: Math.max(0, parseInt(c.offset, 10) || 0),
      limit: Math.min(Config.MAX_PAGE, Math.max(1, parseInt(c.limit, 10) || Config.PAGE_SIZE)),
      withOptions: c.withOptions === true
    };
  }

  /** Valores para los filtros: catálogo (activos e inactivos) + lo que realmente aparece en los datos. */
  _options() {
    const eq = new Map(), pe = new Map();
    const collect = (map, name) => {
      const k = Text.key(name);
      if (k && !map.has(k)) map.set(k, Text.clean(name));
    };
    this.equipos.list().forEach(i => collect(eq, i.nombre));
    this.personal.list().forEach(i => collect(pe, i.nombre));
    const seen = this.repo.distinctValues();
    seen.equipos.forEach(n => collect(eq, n));
    seen.personal.forEach(n => collect(pe, n));
    return { equipos: Array.from(eq.values()), personal: Array.from(pe.values()) };
  }
}
