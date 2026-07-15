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
  El admin elige el modo en Configuración → Integraciones (localStorage).

## Seguridad clínica

- **Autoridad de egreso:** epicrisis médica, epicrisis de enfermería y ausencia desde Ficha Médico son
  señales informativas; nunca vacían la cama por sí solas. Solo el reporte masivo de **Alta
  Administrativa** de Gestión de Camas crea el alta, traslado o CMA estadístico.
- **Ventana D a D+1:** el reporte se solicita hasta el día siguiente por el desfase conocido del
  filtro de Rayen. La fecha y hora impresas en cada fila ya son el sello estadístico de Rapa Nui: se
  normalizan, pero no se desplazan nuevamente por zona horaria.
- **CMA por origen exacto:** un alta administrativa viva se clasifica como CMA cuando ingreso y
  egreso estadístico ocurren el mismo día y la cama exacta `CMA R1`…`CMA R4` o `CMA NEO1/2` consta
  en la ubicación Eloísa guardada o en el informe de altas. `R1`/`NEO1` sin prefijo CMA no cuentan.
  Un traslado explícito o un fallecimiento conservan su clasificación administrativa.
- **Sin inferencias por ausencia:** un snapshot completo puede mostrar el pendiente administrativo;
  un snapshot parcial no genera ni siquiera ese pendiente.
- **El registro producido pasa el Zod del propio HHR** y preserva `dateTimestamp` (test
  `producedRecordValidity.test.ts`), así el `save` no es rechazado por validación ni por reglas Firestore.

## Estructura

| Path                                     | Rol                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `contracts/rayenSnapshot.ts`             | Contrato de entrada (lo que produce la extensión)                          |
| `contracts/censusImportDiff.ts`          | Contrato de salida (el diff a revisar)                                     |
| `mapping/bedMapping.ts`                  | Cama/sala/servicio Rayen → `bedId` HHR (+ flag CMA)                        |
| `mapping/rayenToPatientData.ts`          | Encuentro Rayen → `PatientData` (reusa `EMPTY_PATIENT`)                    |
| `mapping/dischargeMapping.ts`            | Tipo de egreso HHR (alta / traslado / CMA · Vivo/Fallecido)                |
| `domain/reconcileCensus.ts`              | Motor de reconciliación puro (ingresos/updates/moves/egresos/conflictos)   |
| `domain/applyCensusImportDiff.ts`        | Aplica el diff → siguiente `DailyRecord` (puro, defensivo)                 |
| `domain/rayenSyncHistory.ts`             | Historial diario agregado, idempotente y acotado                           |
| `importRayenCensusUseCase.ts`            | Use-case `planRayenCensusImport` (planifica el diff)                       |
| `settings/rayenImportSettings.ts`        | Setting de modo (`preview`/`auto`) en localStorage                         |
| `bridge/rayenImportBridge.ts`            | Puente `postMessage` extensión ⇄ app (+ validación de forma)               |
| `bridge/extensionHealthBridge.ts`        | Handshake de versión/capacidades, sin leer información clínica             |
| `hooks/useRayenImportMode.ts`            | Hook reactivo del modo                                                     |
| `hooks/useRayenExtensionHealth.ts`       | Estado listo/parcial/bloqueado y refresco al recuperar foco                |
| `hooks/useRayenImport.ts`                | Orquesta plan→(preview\|auto)→apply→guardar (`useSaveDailyRecordMutation`) |
| `hooks/useRayenSyncAudit.ts`             | Coordina inicio, aplicación, cobertura final y fallo sanitizado            |
| `hooks/useRayenClinicalFill.ts`          | Ejecuta enriquecimiento y cierra la evidencia técnica del run              |
| `components/RayenImportButton.tsx`       | Botón "Sincronizar Eloísa" (barra del censo)                               |
| `components/RayenImportPreviewModal.tsx` | Modal de preview del diff (BaseModal)                                      |
| `components/RayenSyncHistoryModal.tsx`   | Historial operativo del día, sin información clínica individual            |
| `components/RayenImportModeSetting.tsx`  | Selector de modo (panel admin)                                             |
| `index.ts`                               | API pública (único entrypoint externo)                                     |

## Reglas clave

- **Identidad cruzada:** match por `clinicalEpisodeId` (Rayen `encId`) y, si falta, por RUN.
- **Camas:** `Habitacion N`+`Cn`→`H{N}C{n}`; `Recuperacion k`/`Rk`→`Rk` (UTI); `Neo k`→`NEOk`.
- **CMA = tipo de egreso, no ubicación:** un paciente del servicio CMA (`CMA*`) ocupa la misma
  cama real (`CMAR1→R1`, `CMAN1→NEO1`, …); solo su egreso se traduce a tipo CMA (`record.cma[]`).
- **Apply defensivo:** nunca sobrescribe una cama ocupada; reporta lo omitido (`skipped`).
- **Trazabilidad sin PHI:** `rayenSyncHistory` guarda solo actor, tiempos, salud de fuentes y
  agregados del diff/cobertura. No persiste nombres, RUN, diagnósticos ni errores crudos.
- **Historial acotado:** cada `runId` se actualiza en el mismo evento y se conservan máximo 20 por día.
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
  extensión, estados de salud y barra operativa.

## Pendiente

- (Opcional) mover el setting de modo a Firestore para que sea app-wide en vez de por-dispositivo.

## Referencia funcional

- `Eloisa Hospitalizados/PLAN-SINCRONIZACION.md` (mapeo campo-a-campo, camas §2.2–2.4, flujos §4).
