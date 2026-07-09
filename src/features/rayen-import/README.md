# `src/features/rayen-import`

## Propósito

Importar el censo y los movimientos de camas desde **Rayen / Ficha Médico** (sistema
externo) hacia el `DailyRecord` del HHR. La extensión de navegador lee Rayen y produce un
`RayenCensusSnapshot`; este módulo lo **reconcilia** contra el censo actual y genera un
`CensusImportDiff` (ingresos / actualizaciones / traslados / egresos / conflictos) para
**revisión y confirmación** del usuario.

## Modos de sincronización

- **`preview` (default, SIEMPRE seguro):** muestra el diff en un modal y requiere confirmación.
- **`auto` (EXPERIMENTAL):** aplica el diff sin confirmación; si hay **conflictos**, cae al preview
  para revisión manual. El admin elige el modo en Configuración → Integraciones (localStorage).

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
| `importRayenCensusUseCase.ts`            | Use-case `planRayenCensusImport` (planifica el diff)                       |
| `settings/rayenImportSettings.ts`        | Setting de modo (`preview`/`auto`) en localStorage                         |
| `bridge/rayenImportBridge.ts`            | Puente `postMessage` extensión ⇄ app (+ validación de forma)               |
| `hooks/useRayenImportMode.ts`            | Hook reactivo del modo                                                     |
| `hooks/useRayenImport.ts`                | Orquesta plan→(preview\|auto)→apply→guardar (`useSaveDailyRecordMutation`) |
| `components/RayenImportButton.tsx`       | Botón "Importar desde Rayen" (barra del censo)                             |
| `components/RayenImportPreviewModal.tsx` | Modal de preview del diff (BaseModal)                                      |
| `components/RayenImportModeSetting.tsx`  | Selector de modo (panel admin)                                             |
| `index.ts`                               | API pública (único entrypoint externo)                                     |

## Reglas clave

- **Identidad cruzada:** match por `clinicalEpisodeId` (Rayen `encId`) y, si falta, por RUN.
- **Camas:** `Habitacion N`+`Cn`→`H{N}C{n}`; `Recuperacion k`/`Rk`→`Rk` (UTI); `Neo k`→`NEOk`.
- **CMA = tipo de egreso, no ubicación:** un paciente del servicio CMA (`CMA*`) ocupa la misma
  cama real (`CMAR1→R1`, `CMAN1→NEO1`, …); solo su egreso se traduce a tipo CMA (`record.cma[]`).
- **Apply defensivo:** nunca sobrescribe una cama ocupada; reporta lo omitido (`skipped`).
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

- `src/tests/rayen-import/*.test.ts` (Vitest, 38): mapeo de camas, mapeo de paciente, egreso,
  reconciliación, **apply**, setting de modo y validación del puente.

## Pendiente

- La **extensión** que lee Rayen y envía el snapshot por el puente (Fase 2).
- (Opcional) mover el setting de modo a Firestore para que sea app-wide en vez de por-dispositivo.
- Tests RTL de los componentes UI.

## Referencia funcional

- `Eloisa Hospitalizados/PLAN-SINCRONIZACION.md` (mapeo campo-a-campo, camas §2.2–2.4, flujos §4).
