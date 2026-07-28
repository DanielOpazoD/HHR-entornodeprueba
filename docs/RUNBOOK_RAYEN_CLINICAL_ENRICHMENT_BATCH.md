# Rollout de enriquecimiento clínico transaccional Rayen

## Objetivo

Reducir las K hidrataciones, verificaciones y escrituras clínicas por paciente a un lote acotado
por sincronización, sin cambiar la captura de Eloísa ni relajar la autoridad del censo.

El callable `applyRayenClinicalEnrichmentBatch` admite exclusivamente dispositivos, escalas,
signos vitales, sus historiales y `clinicalSyncCheckpoint`. Verifica en una transacción la fecha,
revisión, cama, `clinicalEpisodeId` y cuna clínica antes de escribir. Cada `runId` genera como
máximo un snapshot histórico y `runId`/`mutationId` hacen el reintento idempotente.
El `runId` pertenece a una ejecución de enriquecimiento, no al ciclo de sincronización del censo;
solo el `mutationId` se conserva entre reintentos de transporte de esa misma ejecución.

## Modos

- `off` (por defecto): conserva íntegramente las escrituras por paciente.
- `shadow`: las escrituras por paciente continúan apenas quedan listas; al final se observa el mismo
  lote en backend con `dryRun`. Un fallo o demora del observador no retrasa la persistencia clínica.
- `enforced`: el callable aplica el lote. Los errores transitorios tienen un reintento idempotente,
  pero nunca hacen fallback porque su resultado puede ser ambiguo. El flujo actual se usa como
  fallback solo si el callable no existe o aún no está implementado. Rechazos de autenticación,
  revisión, episodio o allowlist se muestran como conflicto y tampoco hacen fallback silencioso.

Configurar con `VITE_RAYEN_CLINICAL_ENRICHMENT_BATCH_MODE`.

## Secuencia operativa

1. Mantener `off` hasta confirmar en `rayenSyncHistory.performance` que `persistence` domina la
   duración clínica y que `patientWrites` crece con el número de pacientes.
2. Desplegar `shadow` durante al menos dos turnos y revisar `functionsTelemetry` con
   `service = rayenClinicalEnrichment`.
3. Exigir cero rechazos inesperados de `permission-denied`, `failed-precondition` y `aborted`.
4. Comparar `targetCount`, `fieldCount`, duración y cobertura con el flujo actual. La telemetría no
   contiene RUT, nombres, camas, ENC_ID ni valores clínicos.
5. Activar `enforced` y vigilar reintentos/fallbacks. Volver a `off` ante errores sostenidos.

## Invariantes

- Máximo 32 pacientes/cunas y 500 KB por lote; censo y snapshot se rechazan antes de escribir si
  su representación supera 900 KB, dejando margen para el overhead de Firestore.
- Una sola lectura del documento de censo dentro de una transacción.
- Coincidencia exacta de `clinicalEpisodeId` en la cama o cuna indicada.
- En `enforced`, coincidencia obligatoria de `lastUpdated` y de `meta.revision` cuando el cliente la
  conoce. `shadow` no bloquea por versión porque no escribe y observa el estado posterior al flujo
  establecido.
- Un snapshot determinista y de creación exclusiva por `runId`; reutilizar un identificador antiguo
  no puede sobrescribir su historia aunque el recibo ya haya salido de la ventana de 16 ejecuciones.
- Ningún dato demográfico o valor clínico en telemetría.

## Rollback

Cambiar el flag a `off`. No requiere migración: los recibos son metadatos acotados y los campos
clínicos conservan exactamente el mismo esquema que el flujo por paciente.
