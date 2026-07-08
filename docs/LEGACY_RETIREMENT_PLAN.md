# Legacy Retirement Plan

Estado: activo
Owner: architecture
Última actualización: 2026-06-30

## Scope

Este plan reduce superficie legacy sin reescribir flujos clínicos estables. La prioridad es retirar o encapsular compatibilidad que todavía aparece en rutas vivas, manteniendo los guardrails actuales verdes.

## Priorities

1. legacy read bridge
   - Mantener cada lectura legacy detrás de `isLegacyBridgeEnabled()`.
   - Convertir consumidores restantes a repositorios canónicos cuando exista evidencia de que la fuente nueva cubre el caso real.
   - No permitir consumidores nuevos sin entrada explícita en gobernanza.

2. role aliases
   - Medir y cerrar alias heredados como `viewer_census`.
   - Mantener autocorrección solo mientras existan cuentas/configuraciones reales con alias.
   - Retirar write-back de canonización cuando la auditoría de roles reporte cero alias.

3. legacy clinical document and legacy episode hydration
   - Mantener la hidratación legacy de documentos clínicos y legacy episode keys encapsulada en controllers dedicados.
   - No propagar shape legacy hacia UI, repositories nuevos ni casos de uso.
   - Migrar documentos/episodios antiguos solo con evidencia de compatibilidad y rollback.

## Non-goals

- No reescribir Firestore, IndexedDB ni el modelo clínico completo en una sola rama.
- No eliminar compatibilidad si todavía protege datos reales no migrados.
- No relajar `check:legacy-read-gating`, `check:compatibility-import-governance` ni reglas de schema/runtime contracts.

## Phases

1. Inventory
   - Ejecutar reportes de compatibility governance y legacy bridge.
   - Identificar consumidores por owner y riesgo clínico.

2. Encapsulation
   - Mover acceso legacy a loaders/controllers dedicados.
   - Añadir tests estáticos que eviten imports nuevos desde UI o feature surfaces no aprobadas.

3. Retirement
   - Retirar una superficie solo cuando haya cero consumidores productivos no gobernados y la fuente canónica tenga cobertura.
   - Actualizar docs, reportes y runbooks en el mismo PR de retiro.

## Closure signals

- `check:legacy-read-gating` pasa con cero consumidores no gateados.
- 0 new legacy read bridge consumers aparecen en reportes de diff respecto del último release.
- `report:compatibility-import-governance` reporta cero imports no autorizados.
- Auditoría de role aliases reporta cero entradas legacy en config/roles y custom claims.
- 0 legacy role aliases detected for 2 consecutive releases antes de retirar el write-back de canonización.
- La hidratación de legacy clinical document y legacy episode queda confinada a controllers compatibles y tests dirigidos.
- 0 legacy hydration leaks outside approved controllers en tests estáticos y revisión de import graph.
- `check:schema-governance` y `check:runtime-contracts` siguen verdes después de cada retiro.
