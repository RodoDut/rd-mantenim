// Ejecutar con: node test/harness.js   (desde la raíz del proyecto)
// Corre la lógica de los .gs con stubs de Apps Script y repositorios en memoria.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const dir = path.join(__dirname, '..') + path.sep;
const TZ = 'America/Argentina/Buenos_Aires';

const fmt = (d, p) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map(x => [x.type, x.value]));
  if (p === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
  if (p === "yyyy-MM-dd'T'HH:mm:ss") return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  if (p === 'yyyyMMdd_HHmmss') return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
  throw new Error('patrón no soportado ' + p);
};

function makeContext(files, testFile) {
  let uuid = 0, locks = 0;
  const ctx = vm.createContext({
    console, Buffer, getLocks: () => locks,
    Utilities: {
      formatDate: (d, tz, p) => fmt(d, p),
      getUuid: () => 'uuid-' + (++uuid),
      base64Decode: b64 => Array.from(Buffer.from(b64, 'base64')).map(x => (x > 127 ? x - 256 : x)),
      newBlob: () => ({})
    },
    Session: { getScriptTimeZone: () => TZ },
    LockService: { getScriptLock: () => ({ waitLock() { locks++; }, releaseLock() { locks--; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-id' }) }
  });
  files.forEach(f => vm.runInContext(fs.readFileSync(dir + f + (fs.existsSync(dir + f + '.gs') ? '.gs' : '.js'), 'utf8'), ctx, { filename: f }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, testFile), 'utf8'), ctx, { filename: testFile });
  return ctx;
}

// Capa de negocio: lo único que debe cargarse para que los servicios funcionen.
const DOMAIN = ['Config', 'Common', 'Ports', 'CriticalSection', 'TrabajoQuery', 'CatalogService',
  'TrabajoMapper', 'TrabajoValidator', 'TrabajoSearch', 'TrabajoService'];
// Adaptadores de Google (Sheets/Drive).
const ADAPTERS = ['Repository', 'Storage', 'TrabajoRepository', 'CatalogRepository'];

console.log('== Adaptadores de Sheets (todos los archivos) ==');
const adapters = makeContext(DOMAIN.concat(ADAPTERS), 'cases.js');
// Planilla falsa: cada prueba asigna SpreadsheetApp.sheet. Solo existe en este contexto
// (la suite de contrato verifica que SpreadsheetApp NO existe en la capa de negocio).
adapters.SpreadsheetApp = { sheet: null, openById() { const s = this.sheet; return { getSheetByName: () => s }; } };
adapters.__run(assert);

console.log('\n== Contrato: capa de negocio SIN código de Sheets/Drive ==');
makeContext(DOMAIN, 'contract.js').__run(assert);
