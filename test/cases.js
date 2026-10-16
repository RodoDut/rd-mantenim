// Se ejecuta dentro del mismo contexto que los .gs (comparte const/class globales).
class FakeCatalogRepo {
  constructor(rows) { this.rows = rows; }
  findAll() { return this.rows.map(r => Object.assign({}, r)); }
  insert(r) { this.rows.push(Object.assign({}, r)); return r; }
  updateById(id, patch) {
    const r = this.rows.find(x => x.ID === id);
    if (!r) throw new Error('no existe');
    Object.assign(r, patch); return r;
  }
}
class FakeTrabajoRepo {
  constructor() { this.rows = []; this.failNext = false; }
  findAll() { return this.rows.map(r => this._plain(r)); }
  firstColumn() { return this.rows.map(r => Dates.iso(r[Config.COL.TS])); }
  insert(r) { if (this.failNext) { this.failNext = false; throw new Error('boom'); } this.rows.push(r); return r; }
  _plain(r) {
    const o = {}; for (const k in r) o[k] = r[k] instanceof Date ? Dates.iso(r[k]) : r[k]; return o;
  }
}
class FakeStorage {
  constructor() { this.saved = []; this.trashed = []; }
  save(bytes, mime, name) { const id = 'f' + (this.saved.length + 1); this.saved.push({ mime, name, n: bytes.length }); return { id, url: 'https://drive.google.com/open?id=' + id }; }
  trash(id) { this.trashed.push(id); }
}
// Hoja de cálculo falsa a nivel de SpreadsheetApp: permite probar SheetRepository REAL
// (ensureColumn, fillEmpty, inspectColumn, findById/updateById por columna de ID).
class FakeSheet {
  constructor(grid, maxCols) { this.grid = grid.map(r => r.slice()); this.maxCols = maxCols || 26; this.fmt = {}; }
  _get(r, c) { const v = (this.grid[r - 1] || [])[c - 1]; return v === undefined ? '' : v; }
  _set(r, c, v) {
    while (this.grid.length < r) this.grid.push([]);
    const row = this.grid[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getLastRow() { let l = 0; this.grid.forEach((row, i) => { if (row.some(v => v !== '')) l = i + 1; }); return l; }
  getLastColumn() { let l = 0; this.grid.forEach(row => row.forEach((v, j) => { if (v !== '') l = Math.max(l, j + 1); })); return l; }
  getMaxRows() { return Math.max(this.grid.length, 1000); }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter() {}
  insertColumnsAfter(pos, n) { this.maxCols += n; }
  getRange(r, c, nr, nc) {
    const s = this, rows = nr || 1, cols = nc || 1;
    const range = {
      getValues: () => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => s._get(r + i, c + j))),
      setValues: vals => { vals.forEach((row, i) => row.forEach((v, j) => s._set(r + i, c + j, v))); return range; },
      setValue: v => { s._set(r, c, v); return range; },
      setNumberFormat: f => { for (let j = 0; j < cols; j++) s.fmt[c + j] = f; return range; },
      setFontWeight: () => range
    };
    return range;
  }
}

function __run(assert) {
  const mk = () => {
    const cs = new ScriptLockCriticalSection();
    // Doble de SheetRepository (nivel planilla) envuelto por los adaptadores reales de Sheets.
    const equipos = new CatalogService(new SheetCatalogRepository(new FakeCatalogRepo([
      { ID: 'e1', Nombre: 'Puente Grúa 2', Activo: true },
      { ID: 'e2', Nombre: 'Estiradora', Activo: true },
      { ID: 'e3', Nombre: 'Equipo viejo', Activo: false }])), cs, 'equipo');
    const personal = new CatalogService(new SheetCatalogRepository(new FakeCatalogRepo([
      { ID: 'p1', Nombre: 'Carla Gomez', Activo: true },
      { ID: 'p2', Nombre: 'Mario Peralta', Activo: true }])), cs, 'persona');
    const repo = new FakeTrabajoRepo(), storage = new FakeStorage(); // repo = la "planilla" falsa
    const trabajos = new SheetTrabajoRepository(repo);
    let t = new Date('2026-10-12T11:30:00.400Z'); // 08:30 ART
    const validator = new TrabajoValidator(equipos, personal, new ImageValidator());
    const svc = new TrabajoService(trabajos, validator, storage, cs, () => t);
    const searcher = new TrabajoSearch(trabajos, equipos, personal);
    return { svc, searcher, validator, repo, trabajos, storage, equipos, personal, cs, setNow: d => { t = d; } };
  };
  const ok = (name, fn) => { fn(); console.log('ok  -', name); };
  const bad = (name, fn, re) => ok(name, () => assert.throws(fn, e => e instanceof ValidationError && re.test(e.message)));
  const base = { equipo: 'puente grua 2', fecha: '2026-10-12', personal: ['carla gomez'], descripcion: 'Cambio de manguera' };
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]).toString('base64');

  ok('catálogos: activeNames devuelve solo activos', () => {
    const { equipos, personal } = mk();
    assert.deepStrictEqual(equipos.activeNames(), ['Puente Grúa 2', 'Estiradora']);
    assert.deepStrictEqual(personal.activeNames(), ['Carla Gomez', 'Mario Peralta']);
  });
  ok('crea: nombres canónicos, creadoEn redondeado, ID UUID, fecha como Date', () => {
    const { svc, repo } = mk();
    const r = svc.create(Object.assign({}, base, { personal: ['carla gomez', 'Julián  Ruiz', 'Torres, Franco', 'CARLA GOMEZ'] }));
    assert.strictEqual(r.equipo, 'Puente Grúa 2');
    assert.strictEqual(r.personal, 'Carla Gomez, Julián Ruiz, Torres Franco');
    assert.strictEqual(r.creadoEn, '2026-10-12T08:30:00');
    assert.ok(/^uuid-\d+$/.test(r.id));
    assert.strictEqual(r.fecha, '2026-10-12');
    const row = repo.rows[0];
    assert.ok(row[Config.COL.TS] instanceof Date && row[Config.COL.FECHA] instanceof Date);
    assert.strictEqual(row[Config.COL.ID], r.id);
    assert.strictEqual(row[Config.COL.IMG], '');
  });
  ok('dos cargas en el mismo segundo: creadoEn único (+1 s) e ID distinto', () => {
    const { svc } = mk();
    const a = svc.create(base), b = svc.create(base), c = svc.create(base);
    assert.deepStrictEqual([a.creadoEn, b.creadoEn, c.creadoEn], ['2026-10-12T08:30:00', '2026-10-12T08:30:01', '2026-10-12T08:30:02']);
    assert.strictEqual(new Set([a.id, b.id, c.id]).size, 3);
  });
  bad('rechaza equipo inactivo', () => mk().svc.create(Object.assign({}, base, { equipo: 'Equipo viejo' })), /equipo/);
  bad('rechaza equipo inexistente', () => mk().svc.create(Object.assign({}, base, { equipo: 'X' })), /equipo/);
  bad('rechaza fecha futura', () => mk().svc.create(Object.assign({}, base, { fecha: '2026-10-13' })), /futura/);
  bad('rechaza fecha imposible', () => mk().svc.create(Object.assign({}, base, { fecha: '2026-02-30' })), /válida/);
  bad('rechaza sin personal', () => mk().svc.create(Object.assign({}, base, { personal: [] })), /persona/);
  bad('rechaza personal solo comas', () => mk().svc.create(Object.assign({}, base, { personal: [' , '] })), /persona/);
  bad('rechaza descripción vacía', () => mk().svc.create(Object.assign({}, base, { descripcion: '   ' })), /descripción/);
  bad('rechaza descripción larga', () => mk().svc.create(Object.assign({}, base, { descripcion: 'x'.repeat(2001) })), /supera/);
  ok('descripción con fórmula se guarda tal cual (texto)', () => {
    const { svc, repo } = mk(); svc.create(Object.assign({}, base, { descripcion: '=IMPORTXML("http://x")' }));
    assert.strictEqual(repo.rows[0][Config.COL.DESC], '=IMPORTXML("http://x")');
  });
  ok('imagen JPEG: sube, guarda URL de Drive, nombre con equipo', () => {
    const { svc, repo, storage } = mk();
    const r = svc.create(Object.assign({}, base, { imagen: { mime: 'image/png', base64: jpeg } })); // mime del cliente se ignora
    assert.strictEqual(storage.saved[0].mime, 'image/jpeg');
    assert.strictEqual(storage.saved[0].name, '20261012_083000_puente-grua-2.jpg');
    assert.strictEqual(r.imagen, 'https://drive.google.com/open?id=f1');
    assert.strictEqual(repo.rows[0][Config.COL.IMG], r.imagen);
  });
  bad('imagen: rechaza no-imagen aunque diga image/jpeg', () =>
    mk().svc.create(Object.assign({}, base, { imagen: { mime: 'image/jpeg', base64: Buffer.from('<html>hola</html>').toString('base64') } })), /Formato/);
  bad('imagen: rechaza > 10 MB', () =>
    mk().svc.create(Object.assign({}, base, { imagen: { mime: 'image/jpeg', base64: Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(10 * 1024 * 1024)]).toString('base64') } })), /10 MB/);
  ok('rollback: si falla el insert, la foto va a papelera', () => {
    const { svc, repo, storage } = mk(); repo.failNext = true;
    assert.throws(() => svc.create(Object.assign({}, base, { imagen: { base64: jpeg } })), /boom/);
    assert.deepStrictEqual(storage.trashed, ['f1']);
    assert.strictEqual(repo.rows.length, 0);
  });
  ok('lock siempre liberado (incluso con error)', () => {
    const { svc, repo } = mk(); repo.failNext = true;
    assert.throws(() => svc.create(base), /boom/);
    assert.strictEqual(getLocks(), 0);
  });

  // Catálogos
  ok('catálogo: alta, duplicado sin tildes/mayúsculas, comas', () => {
    const { equipos } = mk();
    assert.strictEqual(equipos.add('  Compresor   Kaeser ').length, 4);
    assert.throws(() => equipos.add('compresor kaeser'), /ya existe/);
    assert.throws(() => equipos.add('PUENTE GRUA 2'), /ya existe/);
    assert.throws(() => equipos.add('a, b'), /comas/);
    assert.throws(() => equipos.add(' '), /obligatorio/);
  });
  ok('catálogo: duplicado de uno eliminado sugiere reactivar', () => {
    const { equipos } = mk();
    assert.throws(() => equipos.add('equipo viejo'), /eliminado/);
    const items = equipos.setActive('e3', true);
    assert.ok(items.find(i => i.id === 'e3').activo);
  });
  ok('catálogo: renombrar y baja lógica', () => {
    const { equipos } = mk();
    equipos.rename('e2', 'Estiradora 2');
    assert.ok(equipos.activeNames().includes('Estiradora 2'));
    equipos.setActive('e2', false);
    assert.ok(!equipos.activeNames().includes('Estiradora 2'));
    assert.throws(() => equipos.rename('e1', 'estiradora 2'), /ya existe/);
    assert.throws(() => equipos.setActive('zzz', true), /No se encontró/);
    assert.throws(() => equipos.setActive('e1', 'no'), /inválido/);
  });

  // ---- Búsqueda ----
  const seed = () => {
    const m = mk();
    const add = (equipo, fecha, personal, desc, hora) => {
      m.setNow(new Date('2026-10-12T' + hora + 'Z'));
      m.svc.create({ equipo, fecha, personal, descripcion: desc });
    };
    add('Puente Grúa 2', '2026-10-01', ['Carla Gomez', 'Mario Peralta'], 'Cambio de manguera hidráulica', '11:00:00');
    add('Estiradora', '2026-10-05', ['Carla Gomez'], 'Pérdida de aceite', '11:01:00');
    add('Estiradora', '2026-10-09', ['Mario Peralta', 'Julián Ruiz'], 'Ajuste de sensores', '11:02:00');
    add('Puente Grúa 2', '2026-10-09', ['Mario Peralta'], 'Lubricación de ruedas', '11:03:00');
    return m;
  };
  const ids = r => r.items.map(i => i.descripcion);

  ok('búsqueda: sin filtros devuelve todo, orden fecha trabajo desc y luego carga desc', () => {
    const { searcher } = seed(); const r = searcher.search({});
    assert.strictEqual(r.total, 4);
    assert.deepStrictEqual(ids(r), ['Lubricación de ruedas', 'Ajuste de sensores', 'Pérdida de aceite', 'Cambio de manguera hidráulica']);
  });
  ok('búsqueda: por equipo (sin tildes/mayúsculas)', () => {
    const { searcher } = seed();
    assert.strictEqual(searcher.search({ equipo: 'PUENTE GRUA 2' }).total, 2);
    assert.strictEqual(searcher.search({ equipo: 'estiradora' }).total, 2);
    assert.strictEqual(searcher.search({ equipo: 'inexistente' }).total, 0);
  });
  ok('búsqueda: rango de fechas inclusivo, solo desde, solo hasta', () => {
    const { searcher } = seed();
    assert.strictEqual(searcher.search({ desde: '2026-10-05', hasta: '2026-10-09' }).total, 3);
    assert.strictEqual(searcher.search({ desde: '2026-10-09' }).total, 2);
    assert.strictEqual(searcher.search({ hasta: '2026-10-01' }).total, 1);
  });
  ok('búsqueda: personal alguno vs todos', () => {
    const { searcher } = seed();
    assert.strictEqual(searcher.search({ personal: ['carla gomez'] }).total, 2);
    assert.strictEqual(searcher.search({ personal: ['Carla Gomez', 'Julián Ruiz'], modo: 'any' }).total, 3);
    assert.strictEqual(searcher.search({ personal: ['Carla Gomez', 'Mario Peralta'], modo: 'all' }).total, 1);
    assert.strictEqual(searcher.search({ personal: ['Julian Ruiz'] }).total, 1); // "otro" fuera del catálogo
  });
  ok('búsqueda: nombre no coincide por substring (Lucio ≠ Luciano)', () => {
    const { searcher } = seed();
    assert.strictEqual(searcher.search({ personal: ['Luc'] }).total, 0);
  });
  ok('búsqueda: texto libre sobre equipo, personal y descripción (todas las palabras)', () => {
    const { searcher } = seed();
    assert.strictEqual(searcher.search({ q: 'manguera' }).total, 1);
    assert.strictEqual(searcher.search({ q: 'PERDIDA ACEITE' }).total, 1);
    assert.strictEqual(searcher.search({ q: 'estiradora sensores' }).total, 1);
    assert.strictEqual(searcher.search({ q: 'ruiz' }).total, 1);
    assert.strictEqual(searcher.search({ q: 'manguera sensores' }).total, 0);
  });
  ok('búsqueda: filtros combinados (AND)', () => {
    const { searcher } = seed();
    const r = searcher.search({ equipo: 'Estiradora', personal: ['Mario Peralta'], desde: '2026-10-06' });
    assert.deepStrictEqual(ids(r), ['Ajuste de sensores']);
    assert.strictEqual(searcher.search({ equipo: 'Estiradora', personal: ['Carla Gomez'], desde: '2026-10-06' }).total, 0);
  });
  ok('búsqueda: paginación', () => {
    const { searcher } = seed();
    const p1 = searcher.search({ limit: 3 }), p2 = searcher.search({ limit: 3, offset: 3 });
    assert.strictEqual(p1.total, 4); assert.strictEqual(p1.items.length, 3);
    assert.strictEqual(p2.items.length, 1); assert.strictEqual(p2.offset, 3);
    assert.strictEqual(searcher.search({ limit: 9999 }).items.length, 4);
    assert.strictEqual(searcher.search({ offset: -5, limit: 'x' }).items.length, 4);
  });
  ok('búsqueda: opciones del filtro = catálogo (incl. inactivos) + datos históricos', () => {
    const { searcher } = seed();
    const o = searcher.search({ withOptions: true }).opciones;
    assert.ok(o.equipos.includes('Equipo viejo') && o.equipos.includes('Estiradora'));
    assert.ok(o.personal.includes('Julián Ruiz') && o.personal.includes('Carla Gomez'));
    assert.strictEqual(o.personal.filter(n => /ruiz/i.test(n)).length, 1);
    assert.strictEqual(searcher.search({}).opciones, undefined);
  });
  ok('búsqueda: fecha antigua guardada como texto d/M/yyyy también se filtra', () => {
    const { searcher, repo } = seed();
    const C = Config.COL, row = {};
    row[C.TS] = new Date('2026-08-28T18:00:00Z'); row[C.EQUIPO] = 'Camiones'; row[C.FECHA] = '4/09/2026';
    row[C.PERSONAL] = 'Diego López'; row[C.DESC] = 'Paragolpes'; row[C.IMG] = '';
    repo.rows.push(row);
    assert.strictEqual(searcher.search({ desde: '2026-09-01', hasta: '2026-09-30' }).total, 1);
    assert.strictEqual(searcher.search({ equipo: 'camiones' }).items[0].fecha, '2026-09-04');
  });
  bad('búsqueda: fecha inválida', () => mk().searcher.search({ desde: '2026-02-30' }), /desde/);
  bad('búsqueda: desde posterior a hasta', () => mk().searcher.search({ desde: '2026-10-10', hasta: '2026-10-01' }), /posterior/);
  bad('búsqueda: demasiadas personas', () => mk().searcher.search({ personal: Array(51).fill('x') }), /Demasiadas/);
  ok('búsqueda: criterios nulos o basura no rompen', () => {
    const { searcher } = seed();
    assert.strictEqual(searcher.search(null).total, 4);
    assert.strictEqual(searcher.search('hola').total, 4);
    assert.strictEqual(searcher.search({ personal: 'no-array', q: 123, modo: 'raro' }).total, 0); // q=123 no aparece en nada
  });


  // ---- Piezas del refactor SRP, probadas de forma aislada ----
  ok('TrabajoValidator: funciona solo con catálogos falsos (sin repo ni storage)', () => {
    const v = new TrabajoValidator({ activeNames: () => ['Estiradora'] }, { activeNames: () => ['Ana'] }, new ImageValidator());
    const d = v.validate({ equipo: 'ESTIRADORA', fecha: '2026-10-01', personal: ['ana', 'Beto'], descripcion: ' ok ' }, new Date('2026-10-12T12:00:00Z'));
    assert.strictEqual(d.equipo, 'Estiradora');
    assert.deepStrictEqual(d.personal, ['Ana', 'Beto']);
    assert.strictEqual(d.descripcion, 'ok');
    assert.strictEqual(d.imagen, null);
    assert.ok(d.fecha instanceof Date);
  });
  ok('ImageValidator: sin imagen -> null; tamaño máximo configurable', () => {
    assert.strictEqual(new ImageValidator().parse(undefined), null);
    const small = new ImageValidator(30);
    assert.throws(() => small.parse({ base64: Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(40)]).toString('base64') }), /supera/);
    assert.strictEqual(small.parse({ base64: Buffer.from([0xFF, 0xD8, 0xFF, 1]).toString('base64') }).ext, 'jpg');
    assert.strictEqual(new ImageValidator().parse({ base64: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0]).toString('base64') }).mime, 'image/png');
    assert.strictEqual(new ImageValidator().parse({ base64: Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary').toString('base64') }).mime, 'image/webp');
  });
  ok('TrabajoService: orquesta con un validador falso (la validación no vive acá)', () => {
    const repo = new FakeTrabajoRepo(), storage = new FakeStorage();
    const data = { equipo: 'X', fecha: Dates.parseDay('2026-10-01'), personal: ['A'], descripcion: 'd', imagen: { bytes: [1, 2, 3], mime: 'image/png', ext: 'png' } };
    let seen = null;
    const svc = new TrabajoService(new SheetTrabajoRepository(repo), { validate: (i, n) => { seen = { i, n }; return data; } }, storage,
      new ScriptLockCriticalSection(), () => new Date('2026-10-12T11:30:00Z'));
    const r = svc.create({ cualquier: 'cosa' });
    assert.deepStrictEqual(seen.i, { cualquier: 'cosa' });
    assert.strictEqual(storage.saved[0].name, '20261012_083000_x.png');
    assert.strictEqual(r.equipo, 'X'); assert.strictEqual(r.fecha, '2026-10-01');
    assert.strictEqual(repo.rows.length, 1);
  });
  ok('TrabajoService: si el validador rechaza, no se sube foto ni se guarda nada', () => {
    const repo = new FakeTrabajoRepo(), storage = new FakeStorage();
    const svc = new TrabajoService(new SheetTrabajoRepository(repo), { validate: () => { throw new ValidationError('no'); } }, storage, new ScriptLockCriticalSection());
    assert.throws(() => svc.create({}), /no/);
    assert.strictEqual(storage.saved.length, 0); assert.strictEqual(repo.rows.length, 0);
  });
  ok('TimestampId.allocate: pura, salta segundos ocupados', () => {
    const now = new Date('2026-10-12T11:30:00.400Z');
    assert.strictEqual(Dates.iso(TimestampId.allocate(now, new Set())), '2026-10-12T08:30:00');
    assert.strictEqual(Dates.iso(TimestampId.allocate(now, new Set(['2026-10-12T08:30:00', '2026-10-12T08:30:01']))), '2026-10-12T08:30:02');
  });
  ok('SheetTrabajoRepository: toRow/fromRow son inversos y toRow usa exactamente los encabezados', () => {
    const nuevo = { equipo: 'E', fecha: '2026-10-01', personal: ['A', 'B'], descripcion: 'd', imagenUrl: 'https://x' };
    const ts = new Date('2026-10-12T11:30:00Z');
    const row = SheetTrabajoRepository.toRow(nuevo, ts, 'id-1');
    assert.deepStrictEqual(Object.keys(row), Object.values(Config.COL));
    assert.ok(row[Config.COL.TS] instanceof Date && row[Config.COL.FECHA] instanceof Date);
    const plain = {}; for (const k in row) plain[k] = row[k] instanceof Date ? Dates.iso(row[k]) : row[k];
    assert.deepStrictEqual(SheetTrabajoRepository.fromRow(plain), {
      id: 'id-1', creadoEn: '2026-10-12T08:30:00', fecha: '2026-10-01', equipo: 'E', personal: ['A', 'B'], descripcion: 'd', imagenUrl: 'https://x'
    });
  });
  ok('TrabajoMapper.toDto: entidad -> DTO del cliente (personal como texto)', () => {
    assert.deepStrictEqual(
      TrabajoMapper.toDto({ id: 'i', creadoEn: '2026-10-12T08:30:00', fecha: '2026-10-01', equipo: 'E', personal: ['A', 'B'], descripcion: 'd', imagenUrl: 'u' }),
      { id: 'i', creadoEn: '2026-10-12T08:30:00', fecha: '2026-10-01', equipo: 'E', personal: 'A, B', descripcion: 'd', imagen: 'u' });
  });
  ok('TrabajoSearch: funciona con un repositorio y catálogos falsos mínimos (puerto, no planilla)', () => {
    const items = [{ id: '2026-10-01T10:00:00', fecha: '2026-10-01', equipo: 'E1', personal: ['A'], descripcion: 'x', imagenUrl: '' }];
    const repo = { search: c => TrabajoQuery.run(items, c), distinctValues: () => ({ equipos: ['E1'], personal: ['A'] }) };
    const s = new TrabajoSearch(repo, { list: () => [] }, { list: () => [] });
    assert.strictEqual(s.search({ equipo: 'e1' }).total, 1);
    assert.strictEqual(s.search({ equipo: 'e2' }).total, 0);
    assert.deepStrictEqual(s.search({ withOptions: true }).opciones, { equipos: ['E1'], personal: ['A'] });
  });
  ok('adaptadores de Sheets cumplen los puertos', () => {
    const m = mk();
    assert.deepStrictEqual(Ports.missing('TrabajoRepository', m.trabajos), []);
    assert.deepStrictEqual(Ports.missing('CatalogRepository', new SheetCatalogRepository(new FakeCatalogRepo([]))), []);
    assert.deepStrictEqual(Ports.missing('CriticalSection', m.cs), []);
    assert.deepStrictEqual(Ports.missing('FileStorage', new DriveStorage(() => 'x')), []);
    assert.deepStrictEqual(Ports.missing('TrabajoRepository', {}), ['create', 'search', 'distinctValues']);
  });
  ok('SheetCatalogRepository: parsea Activo (TRUE/true/booleano), genera UUID y traduce el patch', () => {
    const fake = new FakeCatalogRepo([{ ID: 'a', Nombre: 'N1', Activo: 'TRUE' }, { ID: 'b', Nombre: 'N2', Activo: false }, { ID: 'c', Nombre: 'N3', Activo: 'false' }]);
    const repo = new SheetCatalogRepository(fake);
    assert.deepStrictEqual(repo.list().map(i => i.activo), [true, false, false]);
    const item = repo.add('Nuevo');
    assert.ok(/^uuid-/.test(item.id) && item.activo === true);
    repo.update('b', { nombre: 'N2b', activo: true });
    assert.deepStrictEqual(fake.rows.find(r => r.ID === 'b'), { ID: 'b', Nombre: 'N2b', Activo: true });
  });
  ok('SheetTrabajoRepository.distinctValues: sin repetir, ignora tildes/mayúsculas', () => {
    const { trabajos, repo } = mk();
    const C = Config.COL;
    const add = (eq, per) => repo.rows.push({ [C.TS]: new Date('2026-10-01T10:00:00Z'), [C.EQUIPO]: eq, [C.FECHA]: new Date(2026, 9, 1), [C.PERSONAL]: per, [C.DESC]: 'x', [C.IMG]: '' });
    add('Estiradora', 'Ana, Beto'); add('ESTIRADORA', 'ana'); add('Flejadora', 'Beto');
    assert.deepStrictEqual(trabajos.distinctValues(), { equipos: ['Estiradora', 'Flejadora'], personal: ['Ana', 'Beto'] });
  });
  ok('TrabajoQuery: función pura (sin planilla) — orden por fecha y creadoEn (el ID es opaco), filtros y paginación', () => {
    const T = (id, creadoEn, fecha, equipo, personal, descripcion) => ({ id, creadoEn, fecha, equipo, personal, descripcion, imagenUrl: '' });
    // IDs invertidos a propósito: el orden NO puede depender del ID.
    const data = [T('zzz', '2026-10-01T10:00:00', '2026-10-01', 'A', ['x'], 'uno'), T('aaa', '2026-10-02T10:00:00', '2026-10-01', 'B', ['y'], 'dos'), T('mmm', '2026-10-03T10:00:00', '2026-09-30', 'A', ['x', 'y'], 'tres')];
    const base = { equipoKey: '', desde: '', hasta: '', personalKeys: [], modo: 'any', tokens: [], offset: 0, limit: 30 };
    assert.deepStrictEqual(TrabajoQuery.run(data, base).items.map(t => t.descripcion), ['dos', 'uno', 'tres']);
    assert.strictEqual(TrabajoQuery.run(data, Object.assign({}, base, { equipoKey: 'a' })).total, 2);
    assert.strictEqual(TrabajoQuery.run(data, Object.assign({}, base, { personalKeys: ['x', 'y'], modo: 'all' })).total, 1);
    const p = TrabajoQuery.run(data, Object.assign({}, base, { limit: 2, offset: 2 }));
    assert.strictEqual(p.total, 3); assert.strictEqual(p.items.length, 1);
  });

  ok('catálogo: un equipo eliminado ya no se puede cargar', () => {
    const { equipos, svc } = mk(); equipos.setActive('e1', false);
    assert.throws(() => svc.create(base), /equipo/);
  });

  // ---- Columna ID: SheetRepository REAL sobre una hoja falsa ----
  const hdr = ['Marca temporal', 'Elegir equipo', 'Elija Fecha', 'Personal Interviniente', 'Descripción', 'Imagen asociada'];
  const datos = [hdr.slice(), ['t1', 'E1', 'f1', 'P1', 'd1', ''], ['t2', 'E2', 'f2', 'P2', 'd2', '']];
  const mkSheet = (grid, maxCols) => {
    const sheet = new FakeSheet(grid, maxCols);
    SpreadsheetApp.sheet = sheet;
    return { sheet, repo: new SheetRepository(Config.TAB_TRABAJOS, Config.TRABAJOS_FORMATS, Config.COL.ID) };
  };

  ok('fromRow: una fila sin ID (cargada por el Form) usa la marca temporal como ID transitorio', () => {
    const t = SheetTrabajoRepository.fromRow({ [Config.COL.TS]: '2026-10-12T08:30:00', [Config.COL.FECHA]: '2026-10-01',
      [Config.COL.EQUIPO]: 'E', [Config.COL.PERSONAL]: 'A', [Config.COL.DESC]: 'd', [Config.COL.IMG]: '' });
    assert.strictEqual(t.id, '2026-10-12T08:30:00');
    assert.strictEqual(t.creadoEn, t.id);
  });
  ok('migración: crea el encabezado ID en G, asigna UUID solo a filas con datos, no toca A-F y es idempotente', () => {
    const { sheet, repo } = mkSheet(datos, 6); // 6 columnas: obliga a insertar la G
    const antes = JSON.stringify(sheet.grid.map(r => r.slice(0, 6)));
    assert.strictEqual(repo.ensureColumn(Config.COL.ID, Config.TRABAJOS_ID_COLUMNA), true);
    assert.strictEqual(sheet.getMaxColumns(), 7);
    let n = 0;
    assert.strictEqual(repo.fillEmpty(Config.COL.ID, () => 'u' + (++n)), 2);
    assert.deepStrictEqual(sheet.grid.map(r => r[6]), ['ID', 'u1', 'u2']);
    assert.strictEqual(JSON.stringify(sheet.grid.map(r => r.slice(0, 6))), antes);
    assert.strictEqual(sheet.fmt[7], '@');
    assert.strictEqual(repo.ensureColumn(Config.COL.ID, Config.TRABAJOS_ID_COLUMNA), false);
    assert.strictEqual(repo.fillEmpty(Config.COL.ID, () => 'otro'), 0);
    assert.deepStrictEqual(sheet.grid.map(r => r[6]), ['ID', 'u1', 'u2']);
  });
  ok('migración: respeta IDs existentes, ignora filas sin dato en A y detecta duplicados', () => {
    const g = [hdr.concat('ID'), ['t1', 'E', 'f', 'P', 'd', '', 'keep'], ['t2', 'E', 'f', 'P', 'd', '', ''],
      ['', '', '', '', '', '', ''], ['t4', 'E', 'f', 'P', 'd', '', 'keep']];
    const { sheet, repo } = mkSheet(g);
    assert.deepStrictEqual(repo.inspectColumn(Config.COL.ID), { exists: true, column: 7, rows: 3, empty: 1, duplicates: ['keep'] });
    let n = 0;
    assert.strictEqual(repo.fillEmpty(Config.COL.ID, () => 'new' + (++n)), 1);
    assert.deepStrictEqual(sheet.grid.map(r => r[6]), ['ID', 'keep', 'new1', '', 'keep']);
  });
  ok('ensureColumn: no pisa una columna ocupada por otro encabezado', () => {
    const { repo } = mkSheet([hdr.concat('Otra'), ['t1', 'E', 'f', 'P', 'd', '', 'x']]);
    assert.throws(() => repo.ensureColumn(Config.COL.ID, 7), /ya tiene contenido/);
  });
  ok('SheetRepository con columna de ID propia: findById/updateById buscan por ID y no por la columna A', () => {
    const g = [hdr.concat('ID'), ['t1', 'E1', 'f', 'P', 'd1', '', 'id-1'], ['t2', 'E2', 'f', 'P', 'd2', '', 'id-2']];
    const { sheet, repo } = mkSheet(g);
    assert.strictEqual(repo.findById('id-2')[Config.COL.EQUIPO], 'E2');
    assert.strictEqual(repo.findById('t2'), null);
    repo.updateById('id-1', { [Config.COL.DESC]: 'nueva' });
    assert.strictEqual(sheet.grid[1][4], 'nueva');
    assert.throws(() => repo.updateById('t1', {}), /No existe/);
    SpreadsheetApp.sheet = new FakeSheet([['ID', 'Nombre', 'Activo'], ['c1', 'N', 'TRUE']]); // catálogos: primera columna
    assert.strictEqual(new SheetRepository('Equipos').findById('c1').Nombre, 'N');
  });
  ok('assertSchema exige la columna ID (setup falla hasta correr migrarIds)', () => {
    const { repo } = mkSheet(datos, 6);
    const trabajos = new SheetTrabajoRepository(repo);
    assert.throws(() => trabajos.assertSchema(), /ID/);
    repo.ensureColumn(Config.COL.ID, Config.TRABAJOS_ID_COLUMNA);
    assert.doesNotThrow(() => trabajos.assertSchema());
  });
  ok('alta sobre planilla con columna ID: UUID en G, marca temporal en A', () => {
    const { sheet, repo } = mkSheet([hdr.concat('ID'), ['t1', 'E', 'f', 'P', 'd', '', 'id-1']]);
    const t = new SheetTrabajoRepository(repo).create({ equipo: 'E', fecha: '2026-10-01', personal: ['A'],
      descripcion: 'd', imagenUrl: '', creadoEn: new Date('2026-10-12T11:30:00Z') });
    const row = sheet.grid[2];
    assert.ok(row[0] instanceof Date);
    assert.strictEqual(row[6], t.id);
    assert.ok(/^uuid-\d+$/.test(t.id));
    assert.strictEqual(t.creadoEn, '2026-10-12T08:30:00');
  });
}
this.__run = __run;
// Nota: los dobles FakeCatalogRepo/FakeTrabajoRepo simulan SheetRepository (nivel planilla).
