# ADR: Recuperación de versiones en conflicto del censo diario

**Estado:** Aceptada (2026-06-26) — en implementación por etapas
**Fecha:** 2026-06-26
**Ámbito:** `dailyRecord` · resolución de conflictos / sync
**Relacionado:** `docs/SYNC_CONCURRENCY_MODEL.md`, `docs/ADR_SYNC_OUTCOME_POLICY.md`,
`docs/ADR_DAILY_CENSUS_MOVEMENT_CONFLICT_INVARIANTS.md`

## Decisión

Cuando ocurre un conflicto de concurrencia en el registro diario (auto-merge o bloqueo
por `ConcurrencyError`), persistir **server-side ambas versiones completas previas** —la
remota y la entrante/local— como snapshots etiquetados, y permitir que `admin` o
`nurse_hospital` (Hospitalizados HHR / enfermería de hospitalizados) previsualicen y
**preserven** cualquiera de ellas desde el centro de conflictos clínicos. Toda restauración
es una escritura **atómica, no destructiva y auditada**.

Se registran **todos** los casos de conflicto/auto-merge (sin tope por conteo). Los snapshots
recuperables **expiran solos a ~48 h** vía TTL nativo de Firestore para acotar el almacenamiento,
mientras que la **auditoría es permanente**: lo que expira es la _capacidad de restaurar_, no el
registro de que el conflicto ocurrió.

## Motivo

La escritura atómica (`saveRecordAtomically`) evita el clobber silencioso y el guard de
borrado evita perder pacientes. Pero el **auto-merge sigue siendo heurístico** (decide campo
por campo con la matriz de políticas) y hoy es **irreversible**:

- En el auto-merge (`attemptConflictAutoMergeRecovery`) se escribe el registro _fusionado_ vía
  cola (`setDoc(merge:true)`), **sin snapshot de ninguna de las dos versiones previas**.
- La **versión local que "pierde" nunca se persiste server-side** (queda solo en IndexedDB del
  cliente); un revisor autorizado de otra sesión no puede recuperarla.
- La auditoría de conflicto (`buildConflictAuditSummary`) guarda **solo agregados**
  (`winnerBreakdown`, `strategyBreakdown`…), **no los valores** de cada versión.
- Los snapshots de `history/` que sí existen en el full-save **no se leen** desde ninguna parte
  (son forenses, no restaurables).

Resultado: si el merge elige mal, no hay vuelta atrás. Para datos clínicos y trazabilidad
(Ley 20.584) esto es un riesgo real de pérdida — el más alineado con la prioridad #1 de la
política de cambios (runtime/datos/clínico).

## Alcance

**Dentro (MVP):**

1. Captura dual de snapshots completos al momento del conflicto/merge.
2. Lectura + preservación por `admin`/`nurse_hospital` desde un **centro de conflictos
   clínicos** reutilizable:
   - censo diario: `src/features/census/components/CensusStaffHeader.tsx`;
   - entrega enfermería: `src/features/handoff/components/HandoffView.tsx`;
   - entrega médica: `src/features/handoff/components/HandoffMedicalContent.tsx`.
3. **Auditoría de la restauración** (requisito explícito).

**Fuera (evita sobreingeniería, por la doctrina del equipo):**

- Editor visual de diff/merge campo-a-campo.
- Versionado universal de otras entidades (clinical-documents ya tiene el suyo).
- Políticas de retención sofisticadas / time-travel general.

## Modelo de datos

Subcolección **dedicada**
`hospitals/{hospitalId}/dailyRecords/{date}/conflictSnapshots/{snapshotId}`, separada del `history/`
existente para que la política de TTL aplique solo a estos blobs recuperables y nunca toque el
historial permanente. Cada documento (id `{conflictId}__{origin}`) lleva:

| Campo                                  | Descripción                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `snapshotTimestamp`                    | server `Timestamp`                                                                                   |
| `origin`                               | `'remote_premerge' \| 'incoming_premerge'` — las dos versiones pre-merge capturadas                  |
| `conflictId`                           | correlaciona con el `ConflictAuditSummary` del merge                                                 |
| `sourceRevision` / `sourceLastUpdated` | versión de origen                                                                                    |
| `expireAt`                             | server `Timestamp` = creación + 48 h; gobierna el TTL nativo. Presente en **todos** estos snapshots. |
| `record`                               | el `DailyRecord` completo sanitizado                                                                 |

En `attemptConflictAutoMergeRecovery` se persisten `remote_premerge` + `incoming_premerge`
(atómicamente, best-effort) **antes** de resolver el merge, cubriendo toda ruta de conflicto. El
`history/` existente (los `pre_write` de `saveRecordAtomically` y el estado previo que se snapshotea
al restaurar) queda **separado y permanente**. La colección `conflictSnapshots/` es **append-only**.

## Retención y expiración (TTL ~48 h)

Se captura **todo** conflicto/auto-merge, y para acotar el almacenamiento sin perder cobertura
los snapshots recuperables se borran solos vía **TTL nativo de Firestore** (política de TTL sobre
el campo `expireAt`):

- **La auditoría es permanente.** `logRepositoryConflictAutoMerged` / `…VersionRestored` viven en
  la colección de auditoría **sin TTL** → la trazabilidad Ley 20.584 («qué cambió, quién, cuándo»)
  no se pierde nunca. Solo expira el **blob recuperable** (la capacidad de _restaurar_).
- **Ventana de restauración ≈ 48 h (configurable).** Pasada la ventana, el revisor autorizado
  conserva la auditoría pero ya no puede restaurar. _Decisión clínica a confirmar: 48 h es suficiente para
  detectar un merge incorrecto en un censo diario (revisión por turno)._
- **Los `pre_write` no cambian:** no llevan `expireAt`, así que la política de TTL no los toca
  (siguen permanentes). El TTL solo afecta los snapshots de conflicto.
- **Borrado best-effort:** Firestore borra «dentro de ~72 h del vencimiento», no al segundo
  exacto. Es limpieza, no un plazo duro — aceptable aquí.
- **Sin cron ni función programada:** el TTL es server-side y de cero mantenimiento (evita la
  sobreingeniería de un job de limpieza). El TTL **no dispara funciones ni auditoría** al borrar,
  por eso la auditoría debe ser independiente del snapshot (como ya está diseñado).
- **Layout (resuelto):** subcolección dedicada `conflictSnapshots/`, separada de `history/`. La
  **política de TTL nativa debe habilitarse sobre el grupo de colección `conflictSnapshots`, campo
  `expireAt`** — así el TTL solo afecta estos blobs recuperables y nunca el historial permanente.

## Contrato de restauración

`restoreDailyRecordVersion(date, snapshotId, reviewContext?)`:

- **Solo `admin` o `nurse_hospital` para revisar snapshots** — enforzado en las **rules** con
  `canManageClinicalConflictSnapshots()` y también en la UI con
  `canManageClinicalConflictCenter()`. Las escrituras/updates/deletes administrativos de la
  subcolección siguen restringidos a mantenimiento admin.
- **Falla cerrado:** primero se escribe la auditoría `CONFLICT_VERSION_RESTORED`; solo si ésta tiene
  éxito se guarda el `record`. Un actor anónimo o un fallo de auditoría **aborta antes** de mutar —
  nunca hay un overwrite clínico sin auditar.
- **Guard anti-rollback:** antes de auditar y guardar, se compara la versión seleccionada contra el
  registro remoto vigente. Si preservar el snapshot eliminaría movimientos visibles posteriores
  (altas, traslados, CMA), reviviría tombstones, removería/cambiaría un paciente activo ya movido o
  dejaría duplicados activos, la restauración queda **bloqueada**. Impactos no bloqueantes
  (por ejemplo handoff enfermería/médico posterior) quedan visibles como `review_required` y se
  registran en auditoría.
- Luego, **full-save atómico** del `record` (reusa `saveRecordAtomically`): el CAS corre contra el
  remoto actual, así que el estado que hubiera se snapshotea como de costumbre — **nunca destructivo**.
- El estado restaurado queda como **una nueva versión** en el historial; nada se pierde.
- Idempotente / reentrante.

## Auditoría (requisito)

Toda restauración se registra vía el puerto de auditoría existente
(`src/services/repositories/ports/repositoryAuditPort.ts`), con un nuevo evento
`logRepositoryConflictVersionRestored`, hermano de `logRepositoryConflictAutoMerged`. Captura:

- **quién** (email/uid del usuario autorizado), **cuándo**,
- `date`, `snapshotId` restaurado, `origin`, `conflictId`,
- `reviewContext` si la acción vino del centro de conflictos:
  - `scope` (`census`, `nursing_handoff`, `medical_handoff`),
  - versión seleccionada,
  - módulos afectados,
  - paciente/cama/RUT si estaban disponibles,
  - campos resumidos antes/después.
  - `restoreImpact`: riesgo (`low`/`medium`/`high`), estado (`safe`/`review_required`/`blocked`),
    módulos impactados, conteo de impactos bloqueantes y muestra de impactos detectados contra el
    registro vigente.

Va a la **misma colección/telemetría de auditoría** que el auto-merge. La restauración
**nunca borra** snapshots (append-only), de modo que la cadena «conflicto → merge → restore»
queda completa y reconstruible. Los datos clínicos incluidos en `reviewContext` son el mínimo
necesario para auditoría operacional del cambio elegido.

## Decisiones abiertas (con recomendación)

1. **Retención — RESUELTO (2026-06-26):** capturar **todos** los conflictos/merge; expiración por
   **TTL ~48 h (configurable)** vía Firestore nativo, sin tope por conteo; la auditoría no expira.
   _Queda solo confirmar que 48 h es la ventana clínica adecuada._
2. **Restore sobre día ya editado:** nueva escritura atómica, no destructivo. → _Recomendado._
3. **Permisos:** `admin` + `nurse_hospital` para revisar/preservar; mantenimiento de blobs solo
   admin. → _Resuelto (2026-07-03)._
4. **¿Capturar también la versión local rechazada en `ConcurrencyError` (bloqueo)?** Es la que
   el usuario podría perder al recargar. → _Recomiendo SÍ (mismo `incoming_premerge`)._

## Plan de pruebas

- **Unit:** captura dual en `attemptConflictAutoMergeRecovery`; contrato de `restoreDailyRecordVersion`
  (atómico, no destructivo); emisión del evento de auditoría con los campos correctos.
- **Emulador (motor real):** conflicto real → ambas versiones quedan en `history/` → un revisor
  autorizado restaura la versión A → el historial conserva todo y el restore queda auditado.
- **UI:** `ConflictPanel` lista versiones del día y dispara el restore (reusa el patrón de
  `ClinicalDocumentVersionHistory`).

## Criterios (mapeo a la política del equipo)

- **Change-Decision Policy #1** (baja riesgo real de pérdida) ✅ · **Prioridad #1** (datos
  clínicos / sync) ✅.
- **Definition of Done:** ADR en el mismo cambio ✅ · tests en flujo crítico ✅ · registrar en
  `DOCUMENTATION_MAP.md` (pendiente del PR de implementación) · `technical-ownership-map.json`
  si toca subsistema crítico.
- **Rubric:** _Estabilidad_ (16), _Seguridad_ (8 — acceso restringido + audit append-only), _Tests_ (12).
- **Anti-sobreingeniería:** MVP acotado; reusa `history/`, `ConflictPanel` y el patrón de
  version-history existente; sin editor de diff.

## Rollout

- La captura dual es **aditiva** (no cambia comportamiento de usuarios clínicos comunes) y la UI es
  restringida a `admin`/`nurse_hospital`; no requiere flag, aunque puede ir tras uno si se prefiere
  gradualidad.
- Costo de almacenamiento acotado por el **TTL ~48 h** (no por conteo): se borran solos.
- **Paso de ops:** habilitar la política de TTL de Firestore sobre `expireAt` (config de proyecto
  vía consola/gcloud, **no** en `firestore.rules`) — debe ir en el PR de implementación.
- Registrar este ADR en `DOCUMENTATION_MAP.md` y enlazarlo desde `SYNC_CONCURRENCY_MODEL.md` en
  el PR de implementación.
