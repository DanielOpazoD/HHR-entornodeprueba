# Fase 3: Refactor mecánico de `admissionDateBackfillService`

## Objetivo

Reducir complejidad mecánica en `src/features/admin/services/admissionDateBackfillService.ts`
sin tocar la política clínica de episodio ni el contrato público del servicio.

## Alcance

- Extraer tipos internos del backfill.
- Extraer la construcción del plan de corrección a un módulo interno.
- Mantener `auditAdmissionDateBackfill` y `applyAdmissionDateBackfill` como entrypoints estables.

## Iteración 1

### Decisión

Se eligió este servicio porque es un hotspot productivo grande, con cobertura directa
y un corte claro entre planificación y ejecución.

### Cambios aplicados

- `admissionDateBackfillTypes.ts`: tipos y estructuras compartidas del backfill.
- `admissionDateBackfillPlanner.ts`: recolección de targets, correcciones y armado del plan.
- `admissionDateBackfillService.ts`: reducido a auditoría, aplicación y reporte.
- Resultado de tamaño: `admissionDateBackfillService.ts` pasó de `399` a `152` líneas.

## Validación ejecutada

- `npm run typecheck`
- `npm exec vitest run src/tests/services/admin/admissionDateBackfillService.test.ts src/tests/integration/admissionEpisodeConsistency.test.ts`
- Estado: validación verde

## Siguiente subfase candidata

1. Revisar si el servicio quedó en tamaño razonable tras esta iteración.
2. Si sigue denso, extraer builders de resultado/audit payload a un módulo interno.
