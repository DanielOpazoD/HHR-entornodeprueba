# Foundation Tracker

> **Histórico:** cierre documentado al 2026-04-05. Los porcentajes, estados y
> recomendaciones siguientes pertenecen a ese ciclo; no describen el commit actual.
> Consultar [estado verificable](../PROJECT_STATUS.md) y
> [cadencia vigente](FOUNDATION_MAINTENANCE_CADENCE.md) para nuevas decisiones.

Última actualización: 2026-04-05

## Resumen

- Roadmap total: `26` tareas
- Completadas: `26`
- Avance global: `100%`

## Estado por bloque

| Bloque    | Alcance                                                            | Estado     | Avance |
| --------- | ------------------------------------------------------------------ | ---------- | -----: |
| `B01-B05` | higiene base, taxonomía, convergencia documental e infraestructura | completado | `100%` |
| `B06-B10` | ownership de controllers, guardrails y scripts públicos            | completado | `100%` |
| `B11-B18` | hotspots, APIs públicas y limpieza transversal                     | completado | `100%` |
| `B19-B23` | tests y documentación generada                                     | completado | `100%` |
| `B24-B26` | sostenibilidad y métricas de convergencia                          | completado | `100%` |

## Tareas `B01-B05`

| Id    | Estado     | Nota                                                                         |
| ----- | ---------- | ---------------------------------------------------------------------------- |
| `B01` | completado | limpieza de `.DS_Store` en el workspace y protección vigente en `.gitignore` |
| `B02` | completado | duplicados `* 2.ts` retirados del árbol activo                               |
| `B03` | completado | taxonomía canónica documentada en `docs/CODEBASE_CANON.md`                   |
| `B04` | completado | `README.md`, `src/README.md` y `ARCHITECTURE.md` alineados con la taxonomía  |
| `B05` | completado | `src/infrastructure/` retirado como capa activa; no admite código nuevo      |

## Tareas `B06-B10`

| Id    | Estado     | Nota                                                                                              |
| ----- | ---------- | ------------------------------------------------------------------------------------------------- |
| `B06` | completado | `features/census/controllers` queda como owner canónico de controllers duplicados                 |
| `B07` | completado | `hooks/controllers` ahora expone shims de compatibilidad para esos basenames                      |
| `B08` | completado | `check:repo-hygiene` detecta copias accidentales y ownership roto entre hooks y census            |
| `B09` | completado | superficie pública de comandos reducida a un set oficial corto en la documentación                |
| `B10` | completado | catálogo canónico de comandos oficiales vs scripts especializados en `docs/DEVELOPER_COMMANDS.md` |

## Siguiente bloque recomendado

1. Ejecutar la próxima ola de megatests sobre `firestore-rules` o `minsalStatsCalculator`
2. Mantener la cadencia mensual definida en `docs/FOUNDATION_MAINTENANCE_CADENCE.md`
3. Sostener `typecheck`, `lint` y `check:repo-hygiene` en verde sin reabrir shims ni deep imports

## Avance temprano `B11-B18`

- `B11` iniciado: los imports productivos dejaron de depender de `src/hooks/contracts/dailyRecordHookContracts` y ahora salen por `src/application/shared/dailyRecordContracts`.
- `B12` completado: el ownership de `useDailyRecordTypes` pasó a `src/context/dailyRecordContextContracts.ts`; `useDailyRecordTypes.ts` queda como shim de compatibilidad.
- `B13` completado: los imports productivos y reexports dejaron de depender del barrel `src/utils/dateUtils`; el consumo ahora apunta a `clinicalDayUtils`, `dateFormattingUtils` y `shiftTimeUtils` según ownership real.
- `B14` completado: `census` queda encapsulado detrás de `@/features/census` como entrypoint externo único y `check:repo-hygiene` bloquea imports nuevos hacia subrutas internas.
- `B15` completado: `handoff` documenta `@/features/handoff` como entrypoint externo único y `check:repo-hygiene` bloquea subrutas nuevas.
- `B16` completado: `transfers` documenta `@/features/transfers` como entrypoint externo único y `check:repo-hygiene` bloquea subrutas nuevas.
- `B17` completado: `clinical-documents` consolida su surface en `public.ts`, `index.ts` pasa a reexportarla y los consumers externos migran al root del feature.
- `B18` completado: `ControllerResult` se centraliza en `src/shared/contracts/controllerResult.ts`, `shared/census/patientContracts.ts` queda como shim de compatibilidad y `check:repo-hygiene` bloquea imports nuevos hacia esos aliases ambiguos.
- `B11` completado: `application/`, `hooks/` y `services/` no-repository dejan de importar contratos raíz de `dailyRecord` y ahora consumen `src/application/shared/dailyRecordContracts` o `src/services/contracts/dailyRecordServiceContracts`; `hooks/contracts/dailyRecordHookContracts.ts` queda como shim.
- `B19` completado: inventario priorizado de megatests en `docs/TEST_MEGATEST_BACKLOG.md`.
- `B20` completado: `ClinicalDocumentsWorkspace.test.tsx` se partió en dos suites (`ClinicalDocumentsWorkspace.test.tsx` + `ClinicalDocumentsWorkspace.behavior.test.tsx`); `useBedManagement.test.ts` se dividió en `useBedManagement.patient-updates.test.ts` y `useBedManagement.operations.test.ts`; la ola siguiente también partió `PatientRowOrbitalQuickActions.test.tsx` en suites `behavior` + `visibility`, `transferService.test.ts` en suites `mutations` + `queries` y `DailyRecordRepository.test.ts` en suites `reads` + `lifecycle`.
- `B21` completado: clasificación de documentación canónica, operativa y generada en `docs/DOCUMENTATION_MAP.md`.
- `B22` completado: decisión explícita sobre `docs/api` como artefacto generado versionado temporalmente.
- `B23` completado: mapa corto de documentación y marcadores de lectura para `docs/api` y `reports`.
- `B24` completado: rutina mensual de simplificación documentada en `docs/FOUNDATION_MAINTENANCE_CADENCE.md` y enlazada desde `docs/QUALITY_GUARDRAILS.md`.
- `B25` completado: `report:quality-metrics` ahora expone señales de convergencia reales (`deep imports`, shims, ownership drift, megatests) además de las señales sintácticas.
- `B26` completado: debt register, baseline técnico y política de cambio sostenible quedaron alineados con la nueva fase de mantenimiento.

## Estado final del programa

- El roadmap de cimientos `B01-B26` quedó ejecutado al `100%`.
- La continuidad ya no depende de abrir un plan nuevo grande, sino de sostener la cadencia mensual y resolver deuda remanente puntual.
- `typecheck` global volvió a verde después de la convergencia de `census`.
- La continuidad post-`B26` se registra en `docs/FOUNDATION_CONTINUATION_TRACKER.md`.

## Regla de mantenimiento

Actualizar este tracker cada vez que un bloque cambie de estado o cuando cambie el porcentaje global del roadmap.
