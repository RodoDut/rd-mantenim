/**
 * TrabajoValidator.gs — reglas de validación y normalización de una carga nueva.
 * No guarda nada ni conoce la planilla: recibe los catálogos por constructor
 * (cualquier objeto con activeNames() sirve) y devuelve datos limpios o lanza ValidationError.
 */
class ImageValidator {
  constructor(maxBytes) {
    this.maxBytes = maxBytes || Config.MAX_IMG_BYTES;
  }

  /**
   * @param {{base64:string}|null|undefined} raw
   * @returns {{bytes:number[], mime:string, ext:string}|null} null cuando no hay imagen
   */
  parse(raw) {
    if (raw == null) return null;
    if (typeof raw !== 'object' || typeof raw.base64 !== 'string' || !raw.base64) {
      throw new ValidationError('La imagen es inválida');
    }
    if (raw.base64.length > this.maxBytes * 1.4) throw new ValidationError('La imagen supera los 10 MB');
    let bytes;
    try {
      bytes = Utilities.base64Decode(raw.base64);
    } catch (e) {
      throw new ValidationError('La imagen es inválida');
    }
    if (bytes.length > this.maxBytes) throw new ValidationError('La imagen supera los 10 MB');
    const mime = ImageValidator.sniff_(bytes); // no se confía en el tipo que informa el cliente
    if (!mime) throw new ValidationError('Formato de imagen no soportado (usá JPG, PNG o WEBP)');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
    return { bytes: bytes, mime: mime, ext: ext };
  }

  static sniff_(bytes) {
    const b = i => bytes[i] & 0xFF; // Apps Script devuelve bytes con signo
    if (bytes.length > 3 && b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return 'image/jpeg';
    if (bytes.length > 4 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47) return 'image/png';
    if (bytes.length > 12 && b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
        b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp';
    return null;
  }
}

class TrabajoValidator {
  /**
   * @param {{activeNames:function():string[]}} equipos
   * @param {{activeNames:function():string[]}} personal
   * @param {ImageValidator} imageValidator
   */
  constructor(equipos, personal, imageValidator) {
    this.equipos = equipos;
    this.personal = personal;
    this.images = imageValidator;
  }

  /**
   * @param {Object} input datos crudos del cliente
   * @param {Date} now instante actual (para rechazar fechas futuras)
   * @returns {{equipo:string, fecha:Date, personal:string[], descripcion:string, imagen:Object|null}}
   */
  validate(input, now) {
    if (!input || typeof input !== 'object') throw new ValidationError('Solicitud inválida');

    // Equipo: debe existir y estar activo; se usa el nombre canónico del catálogo.
    const equipoKey = Text.key(input.equipo);
    const equipo = this.equipos.activeNames().find(n => Text.key(n) === equipoKey);
    if (!equipo) throw new ValidationError('Elegí un equipo de la lista');

    // Fecha: real, y no futura.
    const fecha = Dates.parseDay(input.fecha);
    if (!fecha) throw new ValidationError('La fecha no es válida');
    if (Dates.day(fecha) > Dates.day(now)) throw new ValidationError('La fecha no puede ser futura');

    return {
      equipo: equipo,
      fecha: fecha,
      personal: this._personal(input.personal),
      descripcion: this._descripcion(input.descripcion),
      imagen: this.images.parse(input.imagen)
    };
  }

  _personal(raw) {
    if (!Array.isArray(raw) || raw.length === 0) throw new ValidationError('Indicá al menos una persona');
    if (raw.length > Config.MAX_PERSONAL) throw new ValidationError('Demasiadas personas (máx. ' + Config.MAX_PERSONAL + ')');
    const catalog = this.personal.activeNames();
    const seen = new Set();
    const out = [];
    raw.forEach(p => {
      // Las comas separan nombres en la celda: se reemplazan por espacio.
      const clean = Text.clean(String(p == null ? '' : p).replace(/,/g, ' '));
      if (!clean) return;
      if (clean.length > Config.MAX_NAME) throw new ValidationError('Un nombre supera los ' + Config.MAX_NAME + ' caracteres');
      const k = Text.key(clean);
      if (seen.has(k)) return;
      seen.add(k);
      const canon = catalog.find(n => Text.key(n) === k);
      out.push(canon || clean); // fuera del catálogo = "otro" eventual
    });
    if (!out.length) throw new ValidationError('Indicá al menos una persona');
    return out;
  }

  _descripcion(raw) {
    const d = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').trim();
    if (!d) throw new ValidationError('La descripción es obligatoria');
    if (d.length > Config.MAX_DESC) throw new ValidationError('La descripción supera los ' + Config.MAX_DESC + ' caracteres');
    return d;
  }
}
