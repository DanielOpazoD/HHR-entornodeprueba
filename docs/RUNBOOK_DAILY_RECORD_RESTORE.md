# Restaurar respaldos del censo

La restauración de un día es una decisión explícita del administrador: reemplaza el documento
completo, incluidos CUDYR saneado, cierres, firmas y horas oficiales que estén en él. No reconstruye
la verdad clínica ni vuelve a verificar informes mensuales externos. Conserva ID-01/03, TIME-02,
SAVE-01/02/03. Coordinar primero con quienes trabajan en ese día.

## Restaurar un día desde HHR

1. Entrar como **administrador** a **Mantenimiento y Respaldos → Abrir restauración de un día**.
2. Elegir la fecha censal y el momento anterior al error, en **hora de Rapa Nui**. Se leen minutos
   completos; el servidor recibe UTC explícito. En el cambio de hora de abril una hora repetida
   elige su primera ocurrencia; comprobar el momento si el incidente cruza ese cambio.
3. Consultar la comparación. Revisar camas, cunas, altas, traslados, CMA, episodios, última edición
   y advertencias de ambos estados. Los nombres/documentos permiten reconocer personas y episodios;
   los historiales clínicos completos no se envían en esta respuesta.
4. Si falla la lectura, no hay comparación válida. Un documento inexistente en ese momento se
   rechaza: **no equivale a un día vacío**. Comprobar ventana real de PITR y permisos de la cuenta
   de Functions; nunca fabricar un censo vacío para continuar.
5. Escribir exactamente la fecha y pulsar **Restaurar el día completo**. Si alguien editó el día
   después de la comparación, se rechaza sin escribir y hay que consultar otra vez.
6. Esperar la confirmación. Anotar el identificador de copia previa y su vencimiento. Abrir el día
   en otro equipo y comprobar pacientes/episodios, movimientos, signos vitales y checkpoint Rayen,
   CUDYR y egresos; consultar el evento `CONFLICT_VERSION_RESTORED`, detalle
   `daily_record_restored`, en auditoría. Revisar informes oficiales externos afectados.
7. Para deshacer, pulsar **Comparar para deshacer esta restauración**, revisar y confirmar otra
   vez. La copia guarda exactamente el estado previo; no depende de redondear el momento al minuto.
   La segunda restauración genera otra copia previa y una revisión mayor. Conservar el ID si se
   cierra la pantalla: puede pegarlo en **Copia previa para deshacer**. Los mismos callables aceptan `{ date, backupId }` en lugar de
   `{ date, readTime }`. Nunca mezclar ambas fuentes en una solicitud.

La cuenta de servicio necesita `datastore.databases.get`, `datastore.entities.get/list` y las
escrituras de las rutas existentes. El rol HHR `admin` se comprueba en el servidor en cada llamada;
IAM por sí solo no da acceso desde la pantalla. No se relajan reglas de `clinicalDerived`.
Los dos callables están en `southamerica-east1`, con 1 GB y 540 segundos. Un despliegue autorizado
posterior debe verificar ambos nombres en el inventario. Este cambio no los despliega.

### Ventana y fallos

PITR se activó en `hhr-pruebas` el 2026-11-01 según el contexto operativo. Los siete días crecen
**desde la activación**, no hacia atrás. Se consulta `earliestVersionTime` y el estado de PITR de
la base real, además de rechazar futuro y antigüedad mayor a siete días. Si la lectura vence entre
consulta y restauración, falla cerrada. No usar el emulador para certificar PITR.

Un fallo de red tras enviar no demuestra ni éxito ni fallo del commit: consultar la comparación y
la auditoría antes de repetir. Si ya se confirmó, la versión esperada antigua impide repetir el
reemplazo. No se promete idempotencia de una intención nueva con una versión nueva.

### Atomicidad, copia previa y tamaños

No hay colecciones nuevas. Se reutiliza `dailyRecords/{date}/conflictSnapshots`, TTL `expireAt`
de **48 horas**, y `hospitals/hanga_roa/auditLogs` permanente. Cada restauración guarda:

- Un documento `restore_<uuid>` con el día completo previo, revisión y lista de piezas.
- Una pieza por documento físico `clinicalDerived` previo, en la **misma colección** con su propio
  `expireAt`. Se evita una subcolección bajo un documento con TTL: el borrado no sería en cascada.
- El día restaurado, documentos históricos de episodio y auditoría, en la misma transacción.

Todos los respaldos se preparan antes del reemplazo; una falla en copia o auditoría aborta todo.
Las piezas tienen `snapshotType` propio y no se ofrecen en el restaurador antiguo de conflictos:
ese camino conserva los documentos clínicos vigentes y no podría deshacer una restauración PITR.
El nuevo camino lee la copia completa y falla si falta una pieza o venció su raíz.

No se divide la restauración entre lotes de 400. Se rechaza antes de escribir si supera **200
escrituras**, **4 MB JSON UTF-8 totales** o **900 KB por documento**, con margen para protobuf e
índices. Esto evita el caso de muchas copias de 300 KB. Son límites conservadores del operador,
no una afirmación de que JSON mida exactamente el commit Firestore. Un rechazo del SDK también
aborta todo. Si el día supera los límites, usar recuperación a base nueva y revisión específica
por soporte; no subir el límite ni restaurar por fragmentos sin otro diseño aprobado.

### Documentos de episodio y guardados pendientes

Se reutiliza el contrato de generación de `clinicalDerived`. Un día dividido restaurado recibe
una generación nueva y cada documento de su generación histórica recibe esa generación y la
nueva `dayRevision`. Los documentos físicos sobrantes **no se eliminan**: quedan fuera de la
nueva generación, sin superponerse al censo restaurado. Un día histórico sin división vuelve a
estar sin marcador y no lee esos restos; la próxima división crea otra generación. Todo
reemplazo de documento tuvo copia previa. No cambia `HHR_CLINICAL_DERIVED_SPLIT_FROM`.

La importación JSON existente reintroduce campos por episodio en el día porque un cliente no
puede escribir `clinicalDerived`; no se duplica ni se usa aquí ese flujo. El servidor recupera
los documentos originales con el contrato existente. El analizador de restauración de versiones
(`dailyRecordRestoreImpactAnalyzer`) bloquea pérdidas de movimientos; esa política se conserva
para su flujo. Esta herramienta autoriza explícitamente el reemplazo completo tras comparación,
por lo que no elude el bloqueo del flujo antiguo ni reutiliza su guardado parcial de episodios.

La revisión se calcula desde **la versión actual + 1**, nunca desde la histórica, y `lastUpdated`
avanza incluso dentro del mismo milisegundo. Un guardado completo pendiente con su base anterior
choca con los controles existentes de revisión/versión; el transporte lo conserva para revisión,
sin confirmar ni purgar. Las pruebas nuevas ejecutan el callable de guardado real con una base
sintética anterior; las pruebas existentes de transporte cubren la retención como
`semantic_conflict`. No se modifican colas, parches ni outbox. No se ha verificado en dos equipos
reales ni con sus guardados parciales: revisar pendientes antes de reanudar las ediciones.

## Recuperar la base completa desde copia gestionada

Esto **crea otra base**, no reemplaza `(default)` ni cambia los clientes. Ejecutar solo por el
responsable autorizado, primero en un proyecto separado con datos sintéticos. No ejecutar estos
comandos como parte de pruebas locales ni apuntar HHR a la base recuperada automáticamente.

```sh
# Elegir proyecto, ubicación real y copia READY. No inferir que la más reciente es la correcta.
gcloud firestore backups list --project=PROJECT_ID --format=json
gcloud firestore backups describe BACKUP_ID --location=LOCATION --project=PROJECT_ID

# El destino debe ser un nombre NUEVO y disponible; conservar la base original.
gcloud firestore databases restore \
  --project=PROJECT_ID \
  --source-backup=projects/PROJECT_ID/locations/LOCATION/backups/BACKUP_ID \
  --destination-database=hhr-recovery-YYYYMMDD

# Esperar la operación devuelta por restore hasta done=true, sin error.
gcloud firestore operations describe OPERATION_NAME --project=PROJECT_ID
gcloud firestore databases describe --database=hhr-recovery-YYYYMMDD --project=PROJECT_ID
```

Comprobar con un cliente administrativo **ligado explícitamente al ID nuevo**, en modo lectura:
existencia de días esperados, fecha/versión, identidades y episodios, movimientos, CUDYR, firmas,
subcolecciones `clinicalDerived` y correspondencia de fecha/generación/revisión. Comparar conteos y
muestras conocidas con la copia elegida; no publicar nombres ni volcados clínicos en evidencia.
Una base `READY` no demuestra paridad clínica. Revisar reglas, índices, TTL, IAM, ubicación y
políticas de respaldo de la base recuperada antes de habilitar cualquier aplicación: no asumir
que restaurar datos configura toda la seguridad ni todos los servicios. Un cambio de destino,
copia hacia la base activa o eliminación requiere una decisión separada del responsable.

Las copias diarias tienen 14 días de retención según el contexto operativo; comprobarlo en el
proyecto autorizado. No confundirlas con la ventana PITR ni con las 48 h de copia previa local al
día. El respaldo gestionado tampoco incluye IndexedDB, outbox ni guardados offline de equipos.

Referencias oficiales consultadas para este runbook:
[lecturas PITR y ventana real](https://docs.cloud.google.com/firestore/native/docs/use-pitr),
[comando de restauración](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/databases/restore).

## Evidencia y aceptación pendiente

Las pruebas de Functions usan datos sintéticos y un doble de transacción con escrituras diferidas,
reintento concurrente y fallo de commit. La lectura PITR está aislada en
`createDailyRecordPitrReader`: se comprueban `readOnly`, `readTime`, ventana real, ausencia y fallos.
El emulador no soporta PITR real. Antes de uso clínico, el responsable debe validar en una base
separada con datos sintéticos: IAM de Functions, PITR real de día más episodios, restauración,
deshacer exacto, TTL, auditoría y conflicto visible en otro equipo con guardado pendiente.
