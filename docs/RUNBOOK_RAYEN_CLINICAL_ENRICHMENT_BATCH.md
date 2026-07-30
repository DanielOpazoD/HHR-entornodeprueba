# Rollout de enriquecimiento clínico transaccional Rayen

## Objetivo

Reducir las K hidrataciones, verificaciones y escrituras clínicas por paciente a un lote acotado
por sincronización, sin cambiar la captura de Eloísa ni relajar la autoridad del censo.

El callable `applyRayenClinicalEnrichmentBatch` admite exclusivamente dispositivos, escalas,
signos vitales, sus historiales y `clinicalSyncCheckpoint`. Los cambios clínicos y los avances del
checkpoint viajan separados: un lote que solo avanza el checkpoint no crea una versión clínica
idéntica. Verifica en una transacción la fecha, revisión, cama, `clinicalEpisodeId` y cuna RN antes
de escribir. Cada `runId` genera como máximo un snapshot histórico y `runId`/`mutationId` hacen el
reintento idempotente.
El `runId` pertenece a una ejecución de enriquecimiento, no al ciclo de sincronización del censo;
solo el `mutationId` se conserva entre reintentos de transporte de esa misma ejecución.

## Modos

- `off`: conserva íntegramente las escrituras por paciente.
- `shadow`: las escrituras por paciente continúan apenas quedan listas; al final se observa el mismo
  lote en backend con `dryRun`. Se conserva para diagnóstico controlado, no como ruta operativa
  habitual. Un fallo del observador no revierte la persistencia clínica y la llamada queda acotada
  a 20 s.
- `enforced`: el callable aplica el lote. Los errores transitorios tienen un reintento idempotente,
  pero nunca hacen fallback porque su resultado puede ser ambiguo. El flujo actual se usa como
  fallback solo si el callable no existe o aún no está implementado. Rechazos de autenticación,
  revisión, episodio o allowlist se muestran como conflicto y tampoco hacen fallback silencioso.
  Solo se activa explícitamente después de la promoción operativa basada en el gate de paridad.

La ausencia del flag resuelve a `off`. Esto es intencional: si el despliegue de Functions no ocurrió,
un navegador puede presentar el `404` del callable como un error CORS indistinguible de un fallo de
transporte. El cliente no debe arriesgar una segunda escritura tras una respuesta ambigua.

Configurar con `VITE_RAYEN_CLINICAL_ENRICHMENT_BATCH_MODE`.

## Secuencia operativa

1. Confirmar que el workflow `Deploy Firebase Functions` termina correctamente. Requiere el secreto
   de repositorio `FIREBASE_SERVICE_ACCOUNT_HHR`, usa Node 22 y verifica después del despliegue que
   `applyRayenClinicalEnrichmentBatch` exista realmente en `hhr-pruebas`.
2. Antes de una nueva promoción o después de cambios en el contrato, desplegar `shadow` durante
   varias ejecuciones y al menos dos turnos; revisar
   `functionsTelemetry` con
   `service = rayenClinicalEnrichment`.
3. Usar el gate **Lote clínico transaccional** del panel técnico. Para recomendar `enforced` exige
   al menos 4 ejecuciones shadow coincidentes, 8 horas entre la primera y última evidencia, ninguna
   paridad ausente y cero señales bloqueantes.
4. Exigir paridad `matched`, cero rechazos inesperados de `permission-denied`,
   `failed-precondition` y `aborted`, y ausencia de degradación clínica.
5. Comparar `targetCount`, `fieldCount`, duración y cobertura con el flujo actual. La telemetría no
   contiene RUT, nombres, camas, ENC_ID ni valores clínicos.
6. Activar `enforced` mediante configuración explícita; no existe promoción automática. La ausencia
   del flag conserva el flujo `off`. Vigilar reintentos/fallbacks y volver a `off` ante errores
   sostenidos.

## Incrementalidad de lectura y escritura

- El cliente compara el contenido clínico canónico y excluye del lote todo paciente sin un cambio
  clínico efectivo ni avance de checkpoint.
- Un target que solo cambia `clinicalSyncCheckpoint` se persiste en la misma transacción, pero no
  cuenta como parche clínico ni genera snapshot en `history/`. El cliente lo envía en la sección
  `checkpoints`, no duplicado dentro de `patches`.
- Signos vitales, escalas y actividad de dotación conservan identidades/fingerprints acotados y un
  watermark por fuente. La ruta histórica actual de Ficha Médico no acepta un watermark explícito:
  se mantiene su ventana adaptativa normal y se realiza como máximo una revalidación completa cada
  24 horas. La ventana base es de 14 días y se extiende cuando sea necesario para incluir la fecha
  del censo histórico solicitado, hasta el máximo operativo de 180 días del endpoint. Una fecha que
  exceda ese límite no se marca como revalidación completa.
- Para el censo clínico vigente, dispositivos usa primero la respuesta JSON estructurada de Ficha
  Médico. Los censos históricos conservan el PDF fechado como autoridad; el PDF también permanece
  como fallback de compatibilidad cuando el endpoint JSON no está disponible.
- El contador `cacheHits` incluye la reutilización intrarrun del único resultado CUDYR masivo. Para
  `K` episodios elegibles registra `K - 1` lecturas individuales evitadas solo cuando esa lectura
  compartida fue autoritativa; no simula caché cuando el origen falla.

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
