# ADR: Invariantes de movimientos y conflictos del censo diario

**Estado:** Vigente (2026-07-01)
**Ámbito:** `dailyRecord` · censo diario · movimientos · conflictos
**Relacionado:** `ADR_DAILY_CENSUS_TRUTH_CONTRACT.md`, `ADR_CONFLICT_VERSION_RECOVERY.md`, `RUNBOOK_DAILY_RECORD_MOVEMENT_TOMBSTONES.md`

## Decisión

El censo diario no se trata como un documento plano cuando hay concurrencia. Las camas
representan estado actual; los movimientos (`discharges`, `transfers`, `cma`) representan una
bitácora clínica por identidad.

Por lo tanto:

1. Los movimientos se fusionan por `id`, no por reemplazo completo de array.
2. Un movimiento local nuevo debe sobrevivir aunque el snapshot remoto tenga `lastUpdated` más
   reciente.
3. Una eliminación explícita via `deletedAt` domina sobre una copia viva del mismo `id`.
4. Auditoría y estado visible son contratos separados: un evento `PATIENT_DISCHARGED` no reemplaza
   la fila visible en `discharges[]`.
5. Todo traslado/copia de cama debe preservar el snapshot clínico relevante, incluyendo
   diagnóstico.
6. Todo conflicto auto-mergeado debe dejar evidencia explicable: resumen de decisiones y, cuando
   sea posible, snapshots pre-merge recuperables.
7. La verdad seleccionada no es `last write wins`; queda gobernada por autoridad transaccional,
   intención clínica e invariantes según `ADR_DAILY_CENSUS_TRUTH_CONTRACT.md`.

## Motivo

Los incidentes del 2026-07-01 mostraron tres fallas relacionadas:

- un traslado podía hacer que el diagnóstico pareciera desaparecer;
- una alta podía existir en observabilidad pero no aparecer en altas del día;
- un conflicto auto-resuelto podía quedar registrado sin explicación suficiente ni versiones
  recuperables en el panel.

La causa estructural es que distintas partes del flujo mezclaban estado actual, bitácora de
movimientos y evidencia de auditoría como si fueran equivalentes. No lo son.

## Contrato de dominio

| Superficie              | Regla                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `beds`                  | Representa ocupación actual. Un movimiento puede vaciar origen y llenar destino.                 |
| `discharges[]`          | Es fuente visible de altas del día; no debe perder filas locales nuevas en merge.                |
| `transfers[]` / `cma[]` | Misma regla de bitácora por `id`; eliminaciones via tombstone.                                   |
| `auditLogs`             | Explica qué ocurrió, quién lo hizo y con qué metadata, pero no reconstruye por sí solo el censo. |
| `conflictSnapshots/`    | Recuperación operativa temporal; expira por TTL.                                                 |
| `history/`              | Historial permanente del daily record; no se rige por TTL de conflicto.                          |

## Implicancias de implementación

- La política de merge de movimientos vive en
  `src/services/repositories/conflictResolutionMovementMergePolicy.ts`.
- Los payloads de auditoría de censo deben construirse con builders tipados, no con objetos ad-hoc
  por UI.
- La UI de recuperación debe distinguir entre `sin snapshots`, `snapshots no guardados`,
  `snapshots expirados/no disponibles` y `snapshots recuperables`.
- Los tests de regresión deben cubrir el flujo completo: mover cama conserva diagnóstico, alta
  persiste como fila visible y conflicto conserva evidencia comprensible.

## Fuera de alcance

- Editor visual de diff campo-a-campo.
- Reprocesamiento automático de auditorías históricas.
- Nueva arquitectura de event sourcing para todo el censo.

Esta ADR fija invariantes mínimos para reducir deuda sin rediseñar el módulo.
