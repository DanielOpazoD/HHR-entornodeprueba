# Control de almacenamiento Firebase

## Alcance

Los proyectos en uso son `hhr-pruebas` (desarrollo) y
`hhr-serviciohospitalizados` (sitio publicado). `hospital-hanga-roa` es histórico:
su facturación se deshabilitó y este procedimiento lo rechaza.

La mejora conserva documentos, censos, CUDYR, archivos originales y auditoría.
No cambia reglas, IAM, índices compuestos ni el formato de los registros.

## Medición del 13-10-2026, horario de Rapa Nui

Cloud Monitoring informa **datos más índices**, no sólo documentos:

| Proyecto                   | Bytes de datos e índices | Copias `history` |                 Archivos CUDYR |
| -------------------------- | -----------------------: | ---------------: | -----------------------------: |
| hhr-pruebas                |           20.218.730.634 |           12.727 |                  65 originales |
| hhr-serviciohospitalizados |           17.640.207.904 |           23.775 | No tiene ese archivo histórico |

En ambos proyectos PITR está desactivado. La métrica consultada de respaldos no
devolvió series; eso no demuestra por sí solo ausencia de cualquier respaldo.
Los índices desplegados son los cuatro compuestos del repositorio; no había
exenciones de los campos grandes del censo. Las copias completas se repiten
en `history` y heredan la indexación automática.

Desde el 23-10-2026 el navegador guarda en `history` como máximo una copia por hora de cada día
y equipo. Siguen copiando siempre las restauraciones de versión o de respaldo, las importaciones
estructurales de Rayen, el relleno masivo de fechas de ingreso y la primera escritura de cada
importación automática. Las copias ya existentes no cambian.

El muestreo de diez o menos documentos por colección es orientativo, no una
medición exacta del tamaño total de cada colección. Se registraron sólo conteos,
tamaños y nombres de campos, sin valores clínicos ni credenciales.

## Índices de contenido

Se eximen `beds`, `discharges`, `transfers`, `cma` y `rayenSyncHistory` en
`dailyRecords`, `history` y `deletedRecords`; además `conflictSnapshots.record`,
`auditLogs.details` y los campos `base64` de `cudyrSupplementFiles` y
`cudyrContextEvidence`. Son cargas recuperadas por documento/fecha; las búsquedas
de la aplicación no filtran ni ordenan por esos campos.

Para los días divididos de la fase 1a (`DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md`) se
eximen también `clinicalSyncCheckpoint` y `vitalSignsHistory` del grupo `clinicalDerived`, y
`history.clinicalDerivedPrevious`, donde la copia de cada corrida guarda los valores anteriores de
esos campos. La exención de `beds` no los cubre: son otros documentos o un campo raíz. Se aplican
junto con las reglas, antes de activar la división; mientras no haya días marcados no existen
documentos que eximir.

Se mantienen los campos de búsqueda: fecha, identificador de documento,
`snapshotTimestamp`, `timestamp`, `recordDate`, episodio, estado y mes.
Los índices compuestos y las políticas de acceso permanecen intactos.

Una exención sobre un mapa se hereda por sus campos hijos. Antes de agregar una
consulta nueva sobre un campo eximido, definir y desplegar el índice necesario.

## Expiración que ya forma parte del contrato

`conflictSnapshots.expireAt` se guarda como Timestamp de creación más 48 horas.
La UI ya rechaza restauraciones después del vencimiento. El TTL faltaba en la
configuración declarada y desplegada: ahora se declara junto con la exención de
ese campo. Sólo se eliminan automáticamente las copias vencidas de conflicto.
`history`, `dailyRecords`, `deletedRecords` y `auditLogs` **no llevan TTL**.
Los documentos sin un Timestamp válido de vencimiento no se eliminan por TTL.
La política existente `specialtyAiRequests.expireAt` se conserva.

El TTL es asíncrono y cobra las eliminaciones. No crear un cron que duplique la
limpieza, ni prometer desaparición de los datos en el segundo del vencimiento.

## Aplicación reproducible

Con Node 22 y gcloud autenticado con permisos existentes de índices:

```sh
node scripts/apply-firestore-storage-policy.mjs --project=hhr-pruebas
node scripts/apply-firestore-storage-policy.mjs --project=hhr-pruebas --apply
node scripts/apply-firestore-storage-policy.mjs --project=hhr-serviciohospitalizados
node scripts/apply-firestore-storage-policy.mjs --project=hhr-serviciohospitalizados --apply
```

Sin `--apply` sólo lee metadatos y presenta el plan. Antes de la primera
modificación valida toda la configuración, pagina la lista de índices y rechaza
índices hijos explícitos o compuestos que referencien los campos afectados.
Modifica sólo metadatos de campos y registra las operaciones aceptadas. Puede
repetirse después de una interrupción; no acepta otros proyectos ni habilita APIs.
No despliega Functions, reglas ni políticas de producción desde el workflow beta.

Comprobar después: operaciones sin errores, exenciones sin herencia automática,
TTL `ACTIVE`, cuatro índices compuestos `READY`, consultas del censo y auditoría
funcionales y misma huella de los documentos clínicos comprobados.

La aceptación de una operación no demuestra ahorro. Comparar la métrica
`firestore.googleapis.com/storage/data_and_index_storage_bytes` después de la
reclamación del espacio y luego el gasto de almacenamiento del informe de
facturación. No extrapolar un ahorro a partir de muestras de documentos.

## Archivos de despliegue

Sólo repositorios Docker `gcf-artifacts`, no buckets clínicos ni exportaciones:

```sh
gcloud artifacts repositories set-cleanup-policies gcf-artifacts \
  --project=hhr-pruebas --location=us-central1 \
  --policy=scripts/config/firebase-artifact-cleanup.json --no-dry-run
```

Repetir en `southamerica-east1` para pruebas y en `us-central1` para el proyecto
publicado. Inspeccionar primero las políticas existentes: no reemplazar políticas
ajenas. Se conservan las diez versiones más recientes por paquete; sólo se
eliminan versiones sin etiqueta de más de 14 días. La limpieza se ejecuta
asíncronamente. El código fuente permanece en Git; no se eliminan funciones.

## Cambios descartados tras medir

Los 65 originales CUDYR tienen un tamaño pequeño frente a los GiB observados y ya
se deduplican por SHA-256. Se conserva su contrato de verificación y descarga; no
se introduce una migración a Storage para un ahorro todavía no demostrado.
La telemetría tampoco explica el volumen principal: no se recorta su retención
sin definir antes qué evidencia necesita la operación. El indicador mensual ya
usa el resumen persistido; no se cambia su cálculo ni su frecuencia de consulta.

## Reversión

Para reactivar un índice de campo, usar `gcloud firestore indexes fields update`
con `--clear-exemption`, proyecto y grupo explícitos. Esperar que se reconstruya
antes de introducir consultas que lo necesiten. No reactivar la facturación del
proyecto histórico. Deshabilitar TTL no recupera copias ya vencidas y eliminadas;
el historial permanente y la auditoría nunca se incluyen en su política.

Fuentes: [exenciones de índices](https://firebase.google.com/docs/firestore/best-practices),
[TTL](https://firebase.google.com/docs/firestore/ttl),
[limpieza de Artifact Registry](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy).
