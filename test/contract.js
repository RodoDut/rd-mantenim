// Suite de contrato. Se ejecuta en un contexto donde SOLO está cargada la capa de negocio:
// no existen SheetRepository, DriveStorage ni los adaptadores de Sheets. Si algún servicio
// dependiera de ellos, estas pruebas fallarían. Los adaptadores son dobles en memoria que
// implementan los puertos de Ports.gs (así podría ser un adaptador SQL o un servidor distinto).

class InMemoryTrabajoRepository {
  constructor() { this.items = []; this.n = 0; this.failNext = false; }
  create(nuevo) {
    if (this.failNext) { this.failNext = false; throw new Error('boom'); }
    // ID opaco y DECRECIENTE: el orden por creación no puede depender del ID (lo da creadoEn).
    ++this.n;
    const t = { id: 'T' + String(1000000 - this.n), creadoEn: Dates.iso(nuevo.creadoEn), fecha: nuevo.fecha, equipo: nuevo.equipo,
      personal: nuevo.personal.slice(), descripcion: nuevo.descripcion, imagenUrl: nuevo.imagenUrl };
    this.items.push(t);
    return t;
  }
  search(c) { return TrabajoQuery.run(this.items, c); }
  distinctValues() {
    return { equipos: Array.from(new Set(this.items.map(t => t.equipo))),
             personal: Array.from(new Set([].concat(...this.items.map(t => t.personal)))) };
  }
}
class InMemoryCatalogRepository {
  constructor(items) { this.items = items.map(i => Object.assign({}, i)); this.n = 0; }
  list() { return this.items.map(i => Object.assign({}, i)); }
  add(nombre) { const i = { id: 'c' + (++this.n), nombre, activo: true }; this.items.push(i); return Object.assign({}, i); }
  update(id, patch) { Object.assign(this.items.find(i => i.id === id), patch); }
}
class InMemoryStorage {
  constructor() { this.saved = []; this.trashed = []; }
  save(bytes, mime, name) { const id = 'f' + (this.saved.length + 1); this.saved.push(name); return { id, url: 'mem://' + id }; }
  trash(id) { this.trashed.push(id); }
}
class PassThroughCriticalSection { run(fn) { return fn(); } } // otro motor de CriticalSection

function __run(assert) {
  const ok = (name, fn) => { fn(); console.log('ok  -', name); };
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]).toString('base64');
  const mk = () => {
    const cs = new PassThroughCriticalSection();
    const equipos = new CatalogService(new InMemoryCatalogRepository([
      { id: 'e1', nombre: 'Estiradora', activo: true }, { id: 'e2', nombre: 'Flejadora', activo: true }]), cs, 'equipo');
    const personal = new CatalogService(new InMemoryCatalogRepository([
      { id: 'p1', nombre: 'Ana', activo: true }, { id: 'p2', nombre: 'Beto', activo: true }]), cs, 'persona');
    const repo = new InMemoryTrabajoRepository(), storage = new InMemoryStorage();
    let now = new Date('2026-10-12T11:30:00Z');
    const svc = new TrabajoService(repo, new TrabajoValidator(equipos, personal, new ImageValidator()), storage, cs, () => now);
    return { svc, repo, storage, equipos, personal, setNow: d => { now = d; }, search: new TrabajoSearch(repo, equipos, personal) };
  };
  const base = { equipo: 'estiradora', fecha: '2026-10-10', personal: ['ana'], descripcion: 'Cambio de rodamiento' };

  ok('aislamiento: no hay código de Sheets/Drive cargado', () => {
    assert.strictEqual(typeof SheetRepository, 'undefined');
    assert.strictEqual(typeof DriveStorage, 'undefined');
    assert.strictEqual(typeof SheetTrabajoRepository, 'undefined');
    assert.strictEqual(typeof SpreadsheetApp, 'undefined');
    assert.strictEqual(typeof DriveApp, 'undefined');
  });
  ok('los dobles cumplen los puertos', () => {
    assert.deepStrictEqual(Ports.missing('TrabajoRepository', new InMemoryTrabajoRepository()), []);
    assert.deepStrictEqual(Ports.missing('CatalogRepository', new InMemoryCatalogRepository([])), []);
    assert.deepStrictEqual(Ports.missing('FileStorage', new InMemoryStorage()), []);
    assert.deepStrictEqual(Ports.missing('CriticalSection', new PassThroughCriticalSection()), []);
    assert.deepStrictEqual(Ports.missing('CriticalSection', new ScriptLockCriticalSection()), []);
  });
  ok('alta: DTO con el formato que espera el frontend; el ID lo decide el adaptador', () => {
    const { svc } = mk();
    const r = svc.create(Object.assign({}, base, { personal: ['ana', 'Beto'] }));
    assert.deepStrictEqual(r, { id: 'T999999', creadoEn: '2026-10-12T08:30:00', fecha: '2026-10-10', equipo: 'Estiradora', personal: 'Ana, Beto', descripcion: 'Cambio de rodamiento', imagen: '' });
    assert.notStrictEqual(svc.create(base).id, r.id);
  });
  ok('alta con foto: sube a storage y guarda la URL que devuelve', () => {
    const { svc, storage } = mk();
    const r = svc.create(Object.assign({}, base, { imagen: { base64: jpeg } }));
    assert.strictEqual(r.imagen, 'mem://f1');
    assert.strictEqual(storage.saved[0], '20261012_083000_estiradora.jpg');
  });
  ok('rollback: si el repositorio falla, la foto va a la papelera y no queda nada', () => {
    const { svc, repo, storage } = mk(); repo.failNext = true;
    assert.throws(() => svc.create(Object.assign({}, base, { imagen: { base64: jpeg } })), /boom/);
    assert.deepStrictEqual(storage.trashed, ['f1']);
    assert.strictEqual(repo.items.length, 0);
  });
  ok('validación: equipo inexistente, fecha futura y descripción vacía se rechazan antes de tocar nada', () => {
    const { svc, repo, storage } = mk();
    assert.throws(() => svc.create(Object.assign({}, base, { equipo: 'X' })), /equipo/);
    assert.throws(() => svc.create(Object.assign({}, base, { fecha: '2026-10-13' })), /futura/);
    assert.throws(() => svc.create(Object.assign({}, base, { descripcion: ' ' })), /descripción/);
    assert.strictEqual(repo.items.length, 0); assert.strictEqual(storage.saved.length, 0);
  });
  ok('búsqueda: filtros combinados, paginación y opciones, con otro adaptador', () => {
    const { svc, search, setNow } = mk();
    svc.create(base);
    setNow(new Date('2026-10-12T11:31:00Z')); // la hora de carga, no el ID, desempata el orden
    svc.create(Object.assign({}, base, { equipo: 'Flejadora', fecha: '2026-10-11', personal: ['Beto', 'Carla'], descripcion: 'Ajuste' }));
    setNow(new Date('2026-10-12T11:32:00Z'));
    svc.create(Object.assign({}, base, { fecha: '2026-10-11', descripcion: 'Lubricación' }));
    const all = search.search({});
    assert.strictEqual(all.total, 3);
    assert.deepStrictEqual(all.items.map(i => i.descripcion), ['Lubricación', 'Ajuste', 'Cambio de rodamiento']);
    assert.strictEqual(search.search({ equipo: 'FLEJADORA' }).total, 1);
    assert.strictEqual(search.search({ personal: ['Carla'] }).total, 1);
    assert.strictEqual(search.search({ q: 'rodamiento', desde: '2026-10-10', hasta: '2026-10-10' }).total, 1);
    assert.strictEqual(search.search({ limit: 2, offset: 2 }).items.length, 1);
    const o = search.search({ withOptions: true }).opciones;
    assert.ok(o.personal.includes('Carla') && o.equipos.includes('Flejadora'));
  });
  ok('catálogo: alta, duplicado, renombrar y baja lógica con otro adaptador', () => {
    const { equipos, svc } = mk();
    assert.strictEqual(equipos.add('Compresor').length, 3);
    assert.throws(() => equipos.add('compresor'), /ya existe/);
    equipos.rename('e2', 'Flejadora 2');
    equipos.setActive('e1', false);
    assert.deepStrictEqual(equipos.activeNames(), ['Flejadora 2', 'Compresor']);
    assert.throws(() => svc.create(base), /equipo/); // Estiradora ya está dada de baja
  });
}
this.__run = __run;
