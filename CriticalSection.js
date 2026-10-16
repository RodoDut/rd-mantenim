/**
 * CriticalSection.gs — adaptador del puerto CriticalSection para Apps Script (LockService).
 * Da exclusión mutua entre ejecuciones simultáneas. No revierte cambios si fn falla:
 * quien escribe en varios pasos debe compensar (p. ej. mandar la foto subida a la papelera).
 */
class ScriptLockCriticalSection {
  /** @param {number} [timeoutMs] espera máxima por el lock */
  constructor(timeoutMs) {
    this.timeoutMs = timeoutMs || 15000;
  }

  run(fn) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(this.timeoutMs);
    } catch (e) {
      throw new ValidationError('El servidor está ocupado. Reintentá en unos segundos.');
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }
}
