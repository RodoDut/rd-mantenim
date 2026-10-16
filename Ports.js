/**
 * Ports.gs — contratos (puertos) que la lógica de negocio necesita. Los servicios dependen
 * SOLO de estas formas; los adaptadores (Sheets, Drive, LockService) las implementan.
 * Para migrar a otra base de datos o servidor se escribe un adaptador nuevo que cumpla el
 * puerto; los servicios, el validador y la búsqueda no se tocan.
 *
 * Ningún puerto menciona encabezados, pestañas, rangos ni locks.
 *
 * ── Tipos ────────────────────────────────────────────────────────────────────
 * @typedef {Object} Trabajo        entidad leída (claves neutras)
 * @property {string}   id           opaco (en Sheets, UUID): nadie lo interpreta ni ordena por él
 * @property {string}   creadoEn     'yyyy-MM-ddTHH:mm:ss', momento de la carga (ordena el historial)
 * @property {string}   fecha        'yyyy-MM-dd', o '' si el dato guardado no se pudo interpretar
 * @property {string}   equipo
 * @property {string[]} personal
 * @property {string}   descripcion
 * @property {string}   imagenUrl    '' si no hay foto
 *
 * @typedef {Object} NuevoTrabajo   lo que el servicio le pide guardar al repositorio
 * @property {string}   fecha        'yyyy-MM-dd'
 * @property {string}   equipo
 * @property {string[]} personal
 * @property {string}   descripcion
 * @property {string}   imagenUrl
 * @property {Date}     creadoEn     instante de la carga
 *
 * @typedef {Object} CriteriosBusqueda   ya validados y normalizados por TrabajoSearch
 * @property {string}   equipoKey    '' = sin filtro; comparación sin tildes ni mayúsculas (Text.key)
 * @property {string}   desde        'yyyy-MM-dd' o ''  (inclusivo, sobre la fecha del trabajo)
 * @property {string}   hasta        'yyyy-MM-dd' o ''  (inclusivo)
 * @property {string[]} personalKeys claves Text.key; [] = sin filtro
 * @property {string}   modo         'any' | 'all'
 * @property {string[]} tokens       palabras (Text.key); todas deben aparecer en equipo, personal o descripción
 * @property {number}   offset
 * @property {number}   limit
 *
 * @typedef {Object} ItemCatalogo
 * @property {string} id
 * @property {string} nombre
 * @property {boolean} activo
 *
 * ── Puertos ──────────────────────────────────────────────────────────────────
 * TrabajoRepository
 *   create(NuevoTrabajo): Trabajo
 *       Asigna el ID (cada motor usa su estrategia: UUID, autoincremental...) y devuelve creadoEn.
 *       Debe llamarse dentro de CriticalSection.run.
 *   search(CriteriosBusqueda): {total:number, items:Trabajo[]}
 *       Orden: fecha del trabajo desc, luego creadoEn desc. TrabajoQuery es la especificación
 *       ejecutable de las reglas de coincidencia; un adaptador SQL debe reproducirlas.
 *   distinctValues(): {equipos:string[], personal:string[]}
 *       Nombres que aparecen en los datos (para armar los filtros), sin repetir.
 *   (Fase de edición: findById(id) y update(id, cambios, versionBase) con control optimista.)
 *
 * CatalogRepository
 *   list(): ItemCatalogo[]
 *   add(nombre): ItemCatalogo        genera el ID
 *   update(id, {nombre?, activo?}): void
 *
 * CriticalSection
 *   run(fn): any
 *       Garantía del contrato: exclusión mutua (dos ejecuciones simultáneas no entran a la vez).
 *       NO garantiza atomicidad ni rollback: con Sheets es solo un lock. Un adaptador SQL puede
 *       implementarlo con una transacción real (que cumple de sobra este contrato), pero los
 *       servicios no deben depender de ese rollback. Un servicio que necesite atomicidad de
 *       verdad requerirá un puerto más fuerte (p. ej. UnitOfWork) que Sheets no puede cumplir.
 *
 * FileStorage
 *   save(bytes, mime, filename): {id:string, url:string}
 *   trash(id): void                  reversible; nunca borrado permanente
 */
const Ports = {
  METHODS: {
    TrabajoRepository: ['create', 'search', 'distinctValues'],
    CatalogRepository: ['list', 'add', 'update'],
    CriticalSection: ['run'],
    FileStorage: ['save', 'trash']
  },

  /** Métodos del puerto que le faltan a `impl` ([] = lo cumple). Se usa en las pruebas de contrato. */
  missing(port, impl) {
    return Ports.METHODS[port].filter(m => !impl || typeof impl[m] !== 'function');
  }
};