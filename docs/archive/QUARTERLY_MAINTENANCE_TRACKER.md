# Quarterly Maintenance Tracker

Última actualización: 2026-04-11

## Resumen

- Alcance activo: `TQ01-TQ15`
- Alcance pedido en esta ola: `TQ01`, `TQ02`, `TQ03`, `TQ05`, `TQ06`, `TQ07`, `TQ08`, `TQ09`, `TQ10`, `TQ11`, `TQ12`, `TQ13`, `TQ14`, `TQ15`
- Estado del alcance pedido: `100%`

## Estado actual

| Id     | Estado                 | Nota                                                                                                                                                      |
| ------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TQ01` | completado             | `Deprecated shim imports in source` bajó a `0` al migrar `ginecobstetriciaClassification` a la fachada canónica `shared/contracts/patientDomainContracts` |
| `TQ02` | completado             | Se priorizó `PatientRow.test.tsx` como siguiente megatest rentable; `useHandoffLogic`, `zodSchemas` y `DailyRecordRepository.lifecycle` quedan como `P3`  |
| `TQ03` | completado             | `PatientRow.test.tsx` se partió en suites `layout-and-actions` y `crib-and-demographics`                                                                  |
| `TQ05` | completado             | Auditoría de permisos ejecutada; `check-legacy-permissions-boundary` sigue verde y `operationalAccessPolicy` mantiene el boundary                         |
| `TQ06` | no requerido por ahora | No apareció drift nuevo en permisos legacy; no fue necesario migrar consumers                                                                             |
| `TQ07` | completado             | Se auditó el seam `legacy-firebase`; ya no quedaban imports source directos al facade deprecated                                                          |
| `TQ09` | completado             | Auditoría de shims sin consumers reales ejecutada; se detectaron controladores handoff deprecated sin referencias                                         |
| `TQ10` | completado             | Se retiraron `medicalPatientHandoffRenderController.ts`, `medicalPatientHandoffViewController.ts` y `handoffScreenController.ts`                          |
| `TQ11` | completado             | `report:quality-metrics` y `report-compatibility-governance` regenerados tras la ola                                                                      |
| `TQ12` | completado             | `docs/TECHNICAL_DEBT_REGISTER.md` actualizado; `legacy-firebase` quedó cerrado                                                                            |
| `TQ13` | completado             | Revisión de boundaries/ownership ejecutada con gates verdes (`permissions boundary`, `typecheck`, `lint`, métricas)                                       |
| `TQ14` | completado             | Reevaluación de cierre ejecutada sobre el nuevo baseline trimestral                                                                                       |
| `TQ15` | completado             | Revalidación de mantenimiento ejecutada; `check:repo-hygiene` y `check-legacy-permissions-boundary` siguen verdes sin drift nuevo en foundations/permisos |

## Señal actual

- `Deprecated shim imports in source`: `0`
- `Megatests >500 lines`: `0`
- `Folder dependency debt`: `0`
- `Release confidence`: `ok`
- `Raw console warn/error outside structured sink`: `0`
- `Governed compatibility shims in source`: `25`
- `Legacy permissions boundary`: `ok`

## Siguiente paso recomendado

1. Mantener la siguiente ola como mantenimiento normal y no como reconstrucción estructural.
2. Mantener la reducción de megatests como disciplina, sin partir suites pequeñas por deporte.
3. Sostener los checks de ownership y boundaries para evitar reapertura de drift.
4. Repetir la auditoría corta de foundations/permisos al inicio de cada ciclo trimestral o cuando cambie la fachada `operationalAccessPolicy`.
