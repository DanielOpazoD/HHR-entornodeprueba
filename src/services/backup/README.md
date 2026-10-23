# `src/services/backup`

## Proposito

- Gestionar respaldos operativos en Firestore y Storage.
- Exponer contratos de lectura/escritura/listado sin mezclar UI con detalles de infraestructura.

## Superficie principal

- `censusStorageService.ts`
  Respaldo y lookup de archivos Excel del censo en Storage.
- `pdfStorageService.ts`
  Respaldo y recuperacion de PDFs historicos.
- `storage*Policy.ts`
  Clasificacion de errores, disponibilidad y notices visibles.

## Contratos

- Los consumers de aplicacion deben preferir resultados tipados (`*WithResult`) cuando existan.
- Los wrappers legacy que devuelven `string | null | boolean` existen por compatibilidad y no deben crecer.
- Las validaciones de fecha y lookup degradado deben pasar por `storageContracts.ts` y `storageErrorPolicy.ts`.

## Invariantes

- Las capas UI no deben clasificar errores de Storage/Firestore en linea.
- La presentacion de tipos/turnos/fechas de respaldos debe reutilizar `@/shared/backup/backupPresentation`.
- Los casos de uso de `backup-export` son dueños del mapping entre resultados de infraestructura y `ApplicationOutcome`.
- La verificacion pasiva de respaldos al entrar a una vista debe ejecutarse solo para roles con capacidad
  operativa real sobre ese modulo.
- Si un lookup remoto falla por permisos de Storage, la UI debe degradar a "respaldo no verificable"
  y no tratarlo como error bloqueante del flujo clinico.
- Cuando la lista remota llega parcial por permisos o metadata incompatible, la UI debe preferir
  notices `info`; reservar `warning` para timeouts o degradaciones que sí requieran atención operativa.
- Los estados visibles de respaldo deben salir del vocabulario operativo compartido
  (`ok`, `degraded`, `pending`, `retrying`, `blocked`, `not_verified`) para que banners,
  toasts y badges no diverjan entre vistas.
- El borrado de archivos y el backfill masivo del browser de respaldos se consideran acciones
  de mantenimiento admin; la UI no debe habilitarlos para perfiles clínicos no administrativos.
- La exportacion local de handoff (`Descarga local`) no debe usar `window.print()` sobre el DOM:
  debe generar el PDF institucional paginado y abrir la impresion desde ese PDF para preservar
  numeracion real de paginas y consistencia entre localhost/Netlify.
