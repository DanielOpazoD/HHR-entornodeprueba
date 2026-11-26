# Legacy Retirement Plan

Estado: activo
Owner: architecture
Última actualización: 2026-11-23

## Scope

Este plan reduce superficie legacy sin reescribir flujos clínicos estables. La prioridad es retirar o encapsular compatibilidad que todavía aparece en rutas vivas, manteniendo los guardrails actuales verdes.

El puente de lectura de Firebase antiguo y el alias de rol heredado `viewer_census` fueron retirados. Se conservan las normalizaciones de documentos históricos del camino vigente mientras sigan siendo necesarias.

## Priorities

1. role aliases (retirado)
   - El alias heredado `viewer_census` y su write-back de canonización fueron retirados de reglas, Functions, Netlify auth y `roleService`.
   - `legacyRoleAliasStatic.test.ts` mantiene el bloqueo en cero entradas.

2. legacy clinical document (retirado) and legacy episode hydration
   - Los valores por defecto de actores de auditoría v1 en legacy clinical document (`LEGACY_AUDIT_ACTOR_DEFAULTS` / `normalizeLegacyAuditActors`) fueron retirados de `src/domain/clinical-documents/compatibility.ts` con presupuesto `0/0`.
   - Mantener la hidratación de legacy episode keys (`rut__admissionDate`) encapsulada en `src/domain/clinical-episode/clinicalEpisode.ts` mientras existan ingresos manuales sin `clinicalEpisodeId` de Eloísa.
   - No propagar shape legacy hacia UI, repositories nuevos ni casos de uso.

## Non-goals

- No reescribir Firestore, IndexedDB ni el modelo clínico completo en una sola rama.
- No eliminar compatibilidad si todavía protege datos reales no migrados.
- No relajar las reglas de schema/runtime contracts.

## Phases

1. Inventory
   - Ejecutar `npm run check:legacy-retirement-debt` y revisar consumidores por owner y riesgo clínico.

2. Encapsulation
   - Mover acceso legacy a loaders/controllers dedicados.
   - Añadir tests estáticos que eviten imports nuevos desde UI o feature surfaces no aprobadas.

3. Retirement
   - Retirar una superficie solo cuando haya cero consumidores productivos no gobernados y la fuente canónica tenga cobertura.
   - Actualizar docs, reportes y runbooks en el mismo PR de retiro.

## Closure signals

- Auditoría de role aliases reporta cero entradas legacy en config/roles y custom claims.
- 0 legacy role aliases detected for 2 consecutive releases antes de retirar el write-back de canonización.
- La hidratación de legacy clinical document y legacy episode queda confinada a controllers compatibles y tests dirigidos.
- 0 legacy hydration leaks outside approved controllers en tests estáticos y revisión de import graph.
- `check:runtime-contracts` (contratos de ejecución y registro de migradores de esquema) sigue verde después de cada retiro.
