/**
 * Storage.gs — único que toca DriveApp. Guarda fotos y devuelve id + URL.
 * La URL usa el mismo formato que genera el Form (open?id=...).
 */
class DriveStorage {
  /** @param {function():string} folderIdProvider se evalúa recién al guardar */
  constructor(folderIdProvider) {
    this.folderIdProvider = folderIdProvider;
  }

  save(bytes, mime, filename) {
    const folder = DriveApp.getFolderById(this.folderIdProvider());
    const file = folder.createFile(Utilities.newBlob(bytes, mime, filename));
    const id = file.getId();
    return { id: id, url: 'https://drive.google.com/open?id=' + id };
  }

  /** Manda a la papelera (reversible). Nunca borra de forma permanente. */
  trash(id) {
    DriveApp.getFileById(id).setTrashed(true);
  }
}
