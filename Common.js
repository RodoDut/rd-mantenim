/**
 * Common.gs — errores de dominio y utilidades puras compartidas por todas las capas.
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const Text = {
  clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); },
  // Clave de comparación: sin tildes, sin mayúsculas, espacios normalizados.
  key(s) { return Text.clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); },
  slug(s) { return Text.key(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sin-equipo'; }
};