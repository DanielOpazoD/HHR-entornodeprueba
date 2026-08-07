# `src/features/rayen-import`

## Propósito

Importar el censo y los movimientos de camas desde **Rayen / Ficha Médico** (sistema
externo) hacia el `DailyRecord` del HHR. La extensión de navegador lee Rayen y produce un
`RayenCensusSnapshot`; este módulo lo **reconcilia** contra el censo actual y genera un
`CensusImportDiff` (ingresos / actualizaciones / traslados / egresos / conflictos) para
**revisión y confirmación** del usuario.

## Modos de sincronización

- **`preview` (default, SIEMPRE seguro):** muestra el diff en un modal y requiere confirmación.
- **`auto` (EXPERIMENTAL):** aplica el diff sin confirmación, **pero cae al preview** si hay algo que
  requiere revisión — conflictos, señales de cierre aún sin alta administrativa o egresos del reporte
  no representados en HHR. Gate: `requiresReview(diff)`.
  El admin elige una política global en Configuración → Integraciones. Se guarda en Firestore con
  revisión monotónica; caché, documentos inválidos o falta de conexión siempre caen a `preview`.
  Cada ejecución congela modo y revisión al comenzar y los conserva en `rayenSyncHistory`.

La misma política global gobierna de forma independiente la persistencia clínica:

- **`off`:** rollback explícito a la semántica compatible por paciente. Tras migrar la política a
  esquema v2, cada parche sigue pasando por el callable de autoridad; no vuelve a habilitarse la
  escritura clínica directa del navegador.
- **`shadow`:** la ruta compatible conserva autoridad mediante el callable y el lote sólo verifica
  paridad.
- **`enforced`:** el lote transaccional del backend es la única autoridad. Callable ausente,
  respuesta sin paridad o lote fuera de límite fallan cerrado y dejan los datos reintentables; nunca
  degradan silenciosamente a escrituras por paciente.

El modo del lote sólo gobierna el enriquecimiento clínico Rayen: `off` o `shadow` no pueden
degradar una autoridad general del censo configurada de forma independiente como `enforced`.

La política se confirma con el servidor, se versiona y queda congelada por ejecución. Caché local,
esquemas inválidos o ausencia del evento de ejecución bloquean el paso clínico. Una política v1 sólo
puede mostrarse como `off` y bloquea toda nueva ejecución hasta que un administrador complete su
migración atómica a v2 desde Configuración;
un evento histórico anterior al contrato clínico conserva la compatibilidad revisión 0 únicamente
mientras la política global siga ausente. En `shadow` y `enforced`, el callable exige que el modo y
la revisión del evento coincidan con la política global vigente.
La promoción y el rollback se realizan en Configuración → Integraciones; no dependen de una variable
Vite del navegador. Cliente y backend usan contrato runtime v2 y la web exige backend v2. El backend
acepta temporalmente clientes v1 sólo para poder desplegar primero Functions y después la web; la
migración posterior de la política a esquema v2 activa el cerco irreversible que bloquea sus
escrituras clínicas directas.
En `off` y `shadow`, cada parche individual demuestra atómicamente mediante el callable que la
revisión congelada sigue vigente antes de tocar la caché local. Una promoción concurrente a
`enforced` cancela los parches restantes y no deja escrituras antiguas en la cola para un replay
posterior.
En `enforced`, el CUDYR de D−1 usa el mismo callable en un lote separado: modifica el documento
histórico, pero demuestra autoridad con el `runId` congelado en el día de la sincronización. Sólo se
admite el día inmediatamente anterior y nunca se degrada al escritor individual. Si cambia la
revisión, el reintento reconstruye el valor completo de scores desde el documento vigente para no
pisar Braden o Downton concurrentes.
Cada ejecución congela además su `sourceDate`; el lote debe declarar la misma `authorityDate` y el
backend la contrasta con el documento que contiene el evento. Sólo un administrador puede escribir
un día distinto del origen. Los reintentos exactos se resuelven por `runId`/`mutationId` antes de
depender del estado clínico mutable, por lo que conservan idempotencia aunque el paciente ya haya
egresado.
`shadow` puede dividir una observación grande porque no persiste. Si una ejecución `enforced`
requiere varios fragmentos, falla antes de la primera mutación; la autoridad nunca acepta un lote
clínico parcialmente aplicado. Un conflicto de revisión en el lote único reconstruye sus valores
desde el censo canónico recién leído antes del único reintento.
Desde que la política usa esquema v2, un guardado estructural completo conserva desde Firestore los
campos clínicos propiedad del backend —por `clinicalEpisodeId`, aun con traslado de cama— y elimina
esos campos si el episodio todavía no ha sido aceptado por la autoridad clínica. Volver a `off` no
desactiva este cerco.

## Seguridad clínica

- **Dos fuentes obligatorias:** una sincronización estructural solo comienza cuando Ficha Médico y
  Gestión de Camas responden con sesiones vigentes. No existe un modo de importación parcial: si
  cualquiera falta, se conserva el censo local y se muestra la conexión que debe recuperarse.
- **Captura coherente:** el worker vuelve a comprobar ambas fuentes antes y después de leerlas,
  exige un censo completo, valida que el establecimiento coincida y rechaza capturas separadas por
  más de dos minutos. Snapshot e informe de egresos viajan juntos como un `RayenSyncBundle`; HHR no
  interpreta la falla de una fuente como ausencia de eventos.
- **Horizonte D/D−7:** el día vigente usa el snapshot completo. Cada uno de los siete días clínicos
  anteriores se reconstruye como una fotografía al cierre de su turno: cada episodio requiere RUN coincidente y
  ubicación en `Flujo_del_Paciente.pdf` anterior a las 08:00 del día hábil siguiente o 09:00 del
  inhábil. Si un egresado ya no figura en las fuentes masivas, se valida su `ENC_ID` + RUN exactos y
  el egreso individual puede probar el intervalo ingreso–egreso. Solo cuando no registra traslado
  previo al corte se conserva la cama que ya constaba en HHR; nunca se inventa una ubicación.
  Episodios no demostrables quedan en revisión; D−8 y anteriores permanecen bloqueados.
- **Sin fallback fragmentado:** HHR rechaza snapshots sueltos o paquetes que no coincidan
  exactamente en establecimiento, rango y marca de captura; nunca vuelve a combinar lecturas
  independientes después de iniciar una sincronización dual.
- **Respuesta correlacionada:** cada intento tiene un identificador único. Si vence, se cancela o
  es reemplazado, cualquier respuesta tardía queda inerte y no puede abrir ni aplicar un diff.

- **Autoridad de egreso:** epicrisis médica, epicrisis de enfermería y ausencia desde Ficha Médico son
  señales informativas; nunca vacían la cama por sí solas. Solo el reporte masivo de **Alta
  Administrativa** de Gestión de Camas crea el alta, traslado o CMA estadístico.
- **Inventario D al día vigente:** para un censo histórico, el reporte administrativo cubre desde
  el día solicitado hasta el día calendario actual inclusive (fin exclusivo: actual+1). Así también
  descubre episodios que ocupaban D pero egresaron varios días después. La hora se convierte de
  `America/Santiago` a `Pacific/Easter` y luego se asigna al día censal de enfermería: antes de las
  08:00/09:00 pertenece a D−1.
- **CMA por origen exacto:** un alta administrativa viva se clasifica como CMA cuando ingreso y
  egreso estadístico ocurren el mismo día y la cama exacta `CMA R1`…`CMA R4` o `CMA NEO1/2` consta
  en la ubicación Eloísa guardada o en el informe de altas. `R1`/`NEO1` sin prefijo CMA no cuentan.
  Un traslado explícito o un fallecimiento conservan su clasificación administrativa.
- **Sin inferencias por ausencia:** un snapshot completo puede mostrar el pendiente administrativo;
  un snapshot parcial no genera ni siquiera ese pendiente.
- **Reubicación tardía con evidencia:** si una cama local bloquea un ingreso y el ocupante pertenece
  a un episodio clínicamente cerrado, HHR consulta solo para ese episodio el informe oficial
  `Flujo_del_Paciente.pdf`. Se exige RUN coincidente y un movimiento entre el ingreso y la captura
  del snapshot. Un PDF ausente, inválido, ambiguo o con una ubicación no mapeable conserva el conflicto.
- **El registro producido pasa el Zod del propio HHR** y preserva `dateTimestamp` (test
  `producedRecordValidity.test.ts`), así el `save` no es rechazado por validación ni por reglas Firestore.

## Estructura

| Path                                            | Rol                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `contracts/rayenSnapshot.ts`                    | Contrato de entrada (lo que produce la extensión)                          |
| `contracts/censusImportDiff.ts`                 | Contrato de salida (el diff a revisar)                                     |
| `mapping/bedMapping.ts`                         | Cama/sala/servicio Rayen → `bedId` HHR (+ flag CMA)                        |
| `mapping/rayenToPatientData.ts`                 | Encuentro Rayen → `PatientData` (reusa `EMPTY_PATIENT`)                    |
| `mapping/dischargeMapping.ts`                   | Tipo de egreso HHR (alta / traslado / CMA · Vivo/Fallecido)                |
| `domain/reconcileCensus.ts`                     | Motor de reconciliación puro (ingresos/updates/moves/egresos/conflictos)   |
| `domain/principalBedMovePlan.ts`                | Resuelve cadenas/intercambios de camas y rechaza destinos bloqueados       |
| `domain/censusPatientIdentityIndex.ts`          | Índice por episodio y RUN para camas principales/cunas                     |
| `mapping/parsePatientFlow.ts`                   | Extrae solo los movimientos de cama del PDF oficial                        |
| `mapping/parseStatisticalDischargeReport.ts`    | Valida intervalo y traslados del egreso individual                         |
| `mapping/encounterWallClock.ts`                 | Normaliza instantes Rayen al reloj local de Rapa Nui                       |
| `bedTraceabilityResolver.ts`                    | Consulta selectiva y fail-closed ante un conflicto de cama                 |
| `domain/historicalSnapshotReconstruction.ts`    | Reconstruye D−1…D−7 al cierre con trazabilidad por episodio                |
| `domain/historicalLocalEgresoEvidence.ts`       | Verifica episodios locales ausentes por ENC_ID + RUN exactos               |
| `domain/applyCensusImportDiff.ts`               | Aplica el diff → siguiente `DailyRecord` (puro, defensivo)                 |
| `domain/rayenSyncHistory.ts`                    | Historial diario agregado, idempotente y acotado                           |
| `domain/rayenSyncPerformance.ts`                | Acumula duración/contadores técnicos sin aceptar payload clínico           |
| `domain/rayenSyncSourceQuality.ts`              | Resume cobertura agregada de médico tratante, sin identidades              |
| `importRayenCensusUseCase.ts`                   | Use-case `planRayenCensusImport` (planifica el diff)                       |
| `settings/rayenImportSettings.ts`               | Contrato v2 fail-safe de importación y persistencia clínica global         |
| `settings/rayenImportPolicyService.ts`          | Suscripción server-confirmed y actualización transaccional admin           |
| `bridge/rayenImportBridge.ts`                   | Puente `postMessage` extensión ⇄ app (+ validación de forma)               |
| `bridge/patientFlowBridge.ts`                   | Canal acotado para solicitar el PDF del episodio en conflicto              |
| `bridge/statisticalDischargeEvidenceBridge.ts`  | Lee el egreso exacto ya autorizado sin descargarlo al usuario              |
| `bridge/extensionHealthBridge.ts`               | Handshake de versión/capacidades, sin leer información clínica             |
| `hooks/useRayenImportMode.ts`                   | Hook server-confirmed; bloquea runs sin política global autoritativa       |
| `hooks/useRayenExtensionHealth.ts`              | Estado listo/parcial/bloqueado y refresco al recuperar foco                |
| `hooks/useRayenImport.ts`                       | Orquesta plan→(preview\|auto)→apply→guardar (`useSaveDailyRecordMutation`) |
| `hooks/useRayenSyncAudit.ts`                    | Coordina inicio, aplicación, cobertura final y fallo sanitizado            |
| `hooks/useRayenClinicalFill.ts`                 | Consume el censo confirmado, enriquece y cierra la evidencia técnica       |
| `components/RayenImportButton.tsx`              | Botón "Sincronizar Eloísa" (barra del censo)                               |
| `components/RayenImportPreviewModal.tsx`        | Modal de preview del diff (BaseModal)                                      |
| `components/RayenSyncHistoryModal.tsx`          | Historial operativo del día, sin información clínica individual            |
| `components/RayenSyncTechnicalMetricsPanel.tsx` | Detalle técnico plegado por ejecución, visible sólo desde el historial     |
| `components/RayenImportModeSetting.tsx`         | Selector de modo (panel admin)                                             |
| `index.ts`                                      | API pública (único entrypoint externo)                                     |

## Reglas clave

- **Identidad cruzada:** match por `clinicalEpisodeId` (Rayen `encId`) y, para datos legacy sin
  episodio, por RUN solo cuando identifica una única hospitalización candidata.
- **Médico tratante por episodio:** la extensión usa primero la asignación visible vinculada al
  `encId` de cada fila de Ficha Médico y conserva el catálogo institucional como respaldo de nombre.
  Nunca infiere un médico desde la cama, el diagnóstico o la especialidad. Una fila visible sin
  médico también es autoritativa y elimina una asignación antigua.
- **Camas:** `Habitacion N`+`Cn`→`H{N}C{n}`; `Recuperacion k`/`Rk`→`Rk` (UTI); `Neo k`→`NEOk`.
- **CMA = tipo de egreso, no ubicación:** un paciente del servicio CMA (`CMA*`) ocupa la misma
  cama real (`CMAR1→R1`, `CMAN1→NEO1`, …); solo su egreso se traduce a tipo CMA (`record.cma[]`).
- **Apply defensivo:** nunca sobrescribe una cama ocupada; reporta lo omitido (`skipped`).
- **Traspaso estructural→clínico:** el guardado entrega un comprobante en memoria de la versión
  exacta y aplicada del mismo día/run. Sólo ese comprobante evita una lectura redundante; los
  reintentos y rutas legadas leen una vez la autoridad. Si el llenado esperó en cola, revalida al
  comenzar y se descarta si un `runId` más nuevo ya reemplazó su estructura.
- **Orden independiente:** las reubicaciones se planifican como lote; cadenas y permutas liberan
  sus orígenes antes de los ingresos, mientras una cadena bloqueada no libera ninguna cama.
- **Trazabilidad sin PHI del paciente:** `rayenSyncHistory` guarda actor, tiempos, duración, salud
  de fuentes y agregados del diff/cobertura. Si una asignación de personal se excluye cerca del
  relevo, conserva evidencia operacional acotada del funcionario (nombre, rol, fuente y hora), pero
  nunca nombres/RUN/diagnósticos de pacientes, contenido clínico ni errores crudos.
- **Historial acotado:** cada `runId` se actualiza en el mismo evento y se conservan máximo 20 por día.
- **Telemetría técnica sin datos clínicos:** el mismo evento `rayenSyncHistory` registra tiempos de
  preflight, captura dual, reconciliación, evidencia histórica, lecturas clínicas, espera de
  escrituras y persistencia, más contadores agregados de solicitudes, caché, parches, reintentos y
  timeouts. También contrasta asignaciones médicas con nombres recibidos y nombres finalmente
  disponibles mediante el catálogo HHR, usando sólo conteos. No crea otra colección, no se proyecta
  a `rayenSync` y sólo se muestra dentro del panel técnico plegado del historial; sus contratos no
  admiten RUN, nombres, camas, `ENC_ID` ni valores clínicos.
- **Concurrencia por fuente:** dispositivos, historial y formularios usan colas independientes de
  máximo cuatro lecturas. Un PDF lento no bloquea las otras fuentes; los guardados del censo
  permanecen serializados para evitar conflictos de escritura.
- **Horizonte temporal acotado:** `RayenSyncBundle` demuestra la coherencia de una captura, no
  promete retención ilimitada. D−1…D−7 combinan snapshot vivo, reporte administrativo, censo local
  y flujo oficial por episodio; el snapshot actual nunca proyecta por sí solo la cama vigente hacia atrás.
- **`moves` ≠ traslados:** `moves` = reubicación de cama dentro del censo; el traslado a otro hospital
  es un _tipo de egreso_ (`DischargeEntry.kind = 'traslado'`).

## Boundaries

- Fuera de la feature, consumir solo desde `@/features/rayen-import`.
- Depende de tipos/constantes de dominio, `CensusManager`, y hooks sancionados
  (`useDailyRecordData`, `useSaveDailyRecordMutation`). No importa servicios de infraestructura directo.

## Wiring

- Botón en `src/features/census/components/CensusStaffHeader.tsx` (gated: no readonly / no especialista).
- Selector de modo en `src/features/admin/components/ConfigurationView.tsx` (pestaña "Integraciones", admin).

## Tests

- `src/tests/rayen-import/*.test.ts`: mapeo de camas/paciente/egreso, reconciliación,
  `requiresReview`, **apply**, Zod del registro producido, settings, navegación y handshake de la
  extensión, estados de salud, captura dual, desfase temporal, cambio de establecimiento y barra
  operativa.

## Referencia funcional

- `Eloisa Hospitalizados/PLAN-SINCRONIZACION.md` (mapeo campo-a-campo, camas §2.2–2.4, flujos §4).
