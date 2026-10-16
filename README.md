# Trabajos de mantenimiento — Web App (Apps Script + Sheets)

Repositorio público de muestra de código (los datos y configuraciones reales no están incluidos). Este README también está copiado como comentario al inicio de `Config.gs`, porque el editor de Apps Script no admite archivos de documentación: si se cambia uno, actualizar el otro.

## Puesta en marcha (ENTORNO DE PRUEBA)

1. script.google.com > Proyecto nuevo (independiente, no vinculado a la planilla). Nombre: `rd-mant (PRUEBA)`.
2. Cargar los 16 archivos de código (tipo Script): `Config`, `Common`, `Ports`, `CriticalSection`, `Repository`, `Storage`, `TrabajoRepository`, `CatalogRepository`, `TrabajoQuery`, `CatalogService`, `TrabajoMapper`, `TrabajoValidator`, `TrabajoSearch`, `TrabajoService`, `Controller`, `Setup`; y `index` (tipo HTML, nombre exacto `index`). Dos formas:
   - **Con clasp (recomendada):** activar la API de Google Apps Script en https://script.google.com/home/usersettings, instalar y autenticar (`npm install -g @google/clasp`, `clasp login`), y desde la raíz del proyecto `clasp push`. Copiar `.clasp.json.example` a `.clasp.json` y poner el `scriptId` del proyecto de prueba (el `.clasp.json` real no se versiona). El `.claspignore` deja afuera `test/`, los `.md` y `test.zip` (subir los tests rompería el proyecto: comparten el ámbito global).
   - **A mano:** pegar cada archivo en el editor. El orden no importa.
   No debe existir ningún `Service.gs` ni `Transaction.gs`: si quedó alguno de una versión anterior, borrarlo (duplica las clases y rompe todo).
3. Configuración del proyecto > marcar "Mostrar el archivo de manifiesto appsscript.json" y reemplazar su contenido por el de `appsscript.json` (con clasp ya viaja).
4. Configuración del proyecto > Propiedades del script: agregar `SPREADSHEET_ID` = id de la COPIA de prueba (el id está en la URL de la planilla).
5. Editor > ejecutar `crearCarpetaDePrueba` (autorizar permisos la primera vez). Crea la carpeta de fotos de prueba y guarda `FOLDER_ID`.
6. **Columna ID** (la pestaña de trabajos necesita la columna `ID` en G; `setup` falla si no está):
   1. Ejecutar `diagnosticoIds`. Es solo lectura: informa cuántas filas tienen datos, cuántas no tienen ID y el rango exacto que se escribiría.
   2. Revisar la salida (Ver > Registros de ejecución). Solo si coincide con lo esperado:
   3. Ejecutar `migrarIds`. Crea el encabezado `ID` en G y asigna un UUID (como texto) a las filas con datos que no lo tienen. Es idempotente: nunca cambia un ID existente ni toca las demás columnas.
7. Ejecutar `setup`. Valida encabezados, crea y siembra las pestañas `Equipos` y `Personal` con datos de ejemplo. Es idempotente.
8. Implementar > Nueva implementación > Aplicación web. Ejecutar como: **Yo**. Quién tiene acceso: **Solo yo**.

## Modelo de datos (resumen)
- Pestaña `Trabajos_mantenimiento`: A–F son las columnas históricas del Form (A = `Marca temporal` = momento de carga, `creadoEn`), **G = `ID`** (UUID, lo asigna la app y no cambia nunca). El historial se ordena por fecha del trabajo y luego por `creadoEn`; el ID es opaco y no ordena nada.
- El Form queda **congelado** como respaldo histórico. Una fila cargada fuera de la app (sin ID) se sigue mostrando, con la marca temporal como ID transitorio, hasta que se corra `migrarIds`. Leer nunca escribe en la planilla.

## Pruebas locales (no se suben a Apps Script)
`node test/harness.js` desde la raíz del proyecto (62 pruebas, requiere Node; probado con 20.19). Incluye una suite de contrato que corre la lógica sin el código de Sheets/Drive.

Arquitectura de puertos y adaptadores: `Controller -> Servicios -> Puertos (Ports.gs) -> Adaptadores (Sheets, Drive, LockService)`. Frontend sin acceso a datos (`index.html`).

## Pasar a producción
Copiar el proyecto a la cuenta de producción, cambiar `SPREADSHEET_ID` y `FOLDER_ID` en Script Properties, correr `diagnosticoIds` y `migrarIds` sobre la copia de la planilla original, ejecutar `setup`, implementar igual que arriba. Nunca se despliega a producción para probar un cambio: primero se prueba todo en la copia.
