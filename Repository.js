/**
 * Repository.gs — ÚNICA capa que toca SpreadsheetApp.
 * Trabaja por encabezados (no por posición), lee/escribe por rangos completos
 * y convierte Date a texto ISO antes de devolver datos.
 */
class SheetRepository {
  /**
   * @param {string} tabName
   * @param {Object<string,string>} [formats] formato de celda por encabezado
   * @param {string} [idHeader] encabezado de la columna de ID para findById/updateById
   *   (por defecto, la primera columna, como en los catálogos)
   */
  constructor(tabName, formats, idHeader) {
    this.tabName = tabName;
    this.formats = formats || {};
    this.idHeader = idHeader || null;
  }

  static plain(v) {
    return v instanceof Date ? Dates.iso(v) : v;
  }

  _spreadsheet() {
    return SpreadsheetApp.openById(Config.spreadsheetId);
  }

  _sheet() {
    const sheet = this._spreadsheet().getSheetByName(this.tabName);
    if (!sheet) throw new Error('No existe la pestaña: ' + this.tabName);
    return sheet;
  }

  _headers(sheet) {
    return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  }

  _record(headers, row) {
    const o = {};
    headers.forEach((h, i) => { o[h] = SheetRepository.plain(row[i]); });
    return o;
  }

  _row(headers, record) {
    const unknown = Object.keys(record).filter(k => headers.indexOf(k) === -1);
    if (unknown.length) {
      throw new Error('Columnas inexistentes en "' + this.tabName + '": ' + unknown.join(', '));
    }
    return headers.map(h => (record[h] !== undefined ? record[h] : ''));
  }

  /** Falla si faltan encabezados esperados (evita escribir en columnas equivocadas). */
  assertHeaders(expected) {
    const headers = this._headers(this._sheet());
    const missing = expected.filter(h => headers.indexOf(h) === -1);
    if (missing.length) {
      throw new Error('Faltan encabezados en "' + this.tabName + '": ' + missing.join(', '));
    }
  }

  /** Crea la pestaña con encabezados si no existe. Devuelve true si la creó. */
  ensureTab(headers) {
    const ss = this._spreadsheet();
    if (ss.getSheetByName(this.tabName)) return false;
    const sheet = ss.insertSheet(this.tabName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return true;
  }

  count() {
    return Math.max(0, this._sheet().getLastRow() - 1);
  }

  findAll() {
    const sheet = this._sheet();
    const last = sheet.getLastRow();
    if (last < 2) return [];
    const headers = this._headers(sheet);
    return sheet.getRange(2, 1, last - 1, headers.length).getValues()
      .filter(r => r[0] !== '')
      .map(r => this._record(headers, r));
  }

  /** Valores de la primera columna (sin encabezado), ya convertidos a texto ISO. */
  firstColumn() {
    const sheet = this._sheet();
    const last = sheet.getLastRow();
    if (last < 2) return [];
    return sheet.getRange(2, 1, last - 1, 1).getValues()
      .map(r => SheetRepository.plain(r[0]))
      .filter(v => v !== '');
  }

  findById(id) {
    return this.findAll().find(r => String(r[this.idHeader || Object.keys(r)[0]]) === String(id)) || null;
  }

  insert(record) {
    this.insertMany([record]);
    return record;
  }

  /** Escribe todas las filas con una sola llamada setValues. */
  insertMany(records) {
    if (!records.length) return;
    const sheet = this._sheet();
    const headers = this._headers(sheet);
    const rows = records.map(r => this._row(headers, r));
    const start = sheet.getLastRow() + 1;
    const needed = start + rows.length - 1;
    if (needed > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
    }
    // Formato por columna (≤ 6 llamadas, no por celda) ANTES de escribir los valores.
    headers.forEach((h, i) => {
      if (this.formats[h]) sheet.getRange(start, i + 1, rows.length, 1).setNumberFormat(this.formats[h]);
    });
    sheet.getRange(start, 1, rows.length, headers.length).setValues(rows);
  }

  /** Actualiza campos de la fila cuyo ID coincide (columna idHeader, o la primera). Lanza si no existe. */
  updateById(id, patch) {
    const sheet = this._sheet();
    const last = sheet.getLastRow();
    const headers = this._headers(sheet);
    const idCol = this.idHeader ? headers.indexOf(this.idHeader) : 0;
    if (idCol === -1) throw new Error('Falta la columna de ID "' + this.idHeader + '" en "' + this.tabName + '"');
    const unknown = Object.keys(patch).filter(k => headers.indexOf(k) === -1);
    if (unknown.length) throw new Error('Columnas inexistentes: ' + unknown.join(', '));
    if (last < 2) throw new Error('No existe el registro: ' + id);
    const values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
    const idx = values.findIndex(r => String(SheetRepository.plain(r[idCol])) === String(id));
    if (idx === -1) throw new Error('No existe el registro: ' + id);
    const row = values[idx].slice();
    headers.forEach((h, i) => { if (patch[h] !== undefined) row[i] = patch[h]; });
    sheet.getRange(idx + 2, 1, 1, headers.length).setValues([row]);
    return this._record(headers, row);
  }

  /** Índice (base 1) de un encabezado, o 0 si no existe. */
  columnIndex(header) {
    const sheet = this._sheet();
    if (sheet.getLastColumn() < 1) return 0;
    return this._headers(sheet).indexOf(header) + 1;
  }

  /**
   * SOLO LECTURA. Resume una columna sobre las filas con datos (las que tienen valor en la columna A):
   * cuántas hay, cuántas celdas están vacías y qué valores se repiten.
   */
  inspectColumn(header) {
    const sheet = this._sheet();
    const col = this.columnIndex(header);
    const last = sheet.getLastRow();
    const out = { exists: col > 0, column: col, rows: 0, empty: 0, duplicates: [] };
    if (last < 2) return out;
    const keys = sheet.getRange(2, 1, last - 1, 1).getValues();
    out.rows = keys.filter(r => r[0] !== '').length;
    if (!col) { out.empty = out.rows; return out; }
    const vals = sheet.getRange(2, col, last - 1, 1).getValues();
    const seen = new Set();
    keys.forEach((k, i) => {
      if (k[0] === '') return;
      const v = String(vals[i][0]).trim();
      if (v === '') { out.empty++; return; }
      if (seen.has(v) && out.duplicates.indexOf(v) === -1) out.duplicates.push(v);
      seen.add(v);
    });
    return out;
  }

  /** Crea el encabezado en la columna `position` (base 1) si no existe en ningún lado. No pisa contenido. */
  ensureColumn(header, position) {
    if (this.columnIndex(header)) return false;
    const sheet = this._sheet();
    if (position > sheet.getMaxColumns()) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), position - sheet.getMaxColumns());
    }
    const last = sheet.getLastRow();
    const occupied = last >= 1 &&
      sheet.getRange(1, position, last, 1).getValues().some(r => String(r[0]).trim() !== '');
    if (occupied) throw new Error('La columna ' + position + ' ya tiene contenido; no se pisa.');
    sheet.getRange(1, position).setValue(header).setFontWeight('bold');
    return true;
  }

  /** Completa con generate() las celdas vacías de la columna, solo en filas con datos. Una sola escritura. */
  fillEmpty(header, generate) {
    const sheet = this._sheet();
    const col = this.columnIndex(header);
    if (!col) throw new Error('No existe la columna: ' + header);
    const last = sheet.getLastRow();
    if (last < 2) return 0;
    const n = last - 1;
    const keys = sheet.getRange(2, 1, n, 1).getValues();
    const range = sheet.getRange(2, col, n, 1);
    const vals = range.getValues();
    let filled = 0;
    keys.forEach((k, i) => {
      if (k[0] !== '' && String(vals[i][0]) === '') { vals[i][0] = generate(); filled++; }
    });
    if (filled) {
      range.setNumberFormat('@');
      range.setValues(vals);
    }
    return filled;
  }
}