# `src/features/handoff`

## Proposito

Entrega de turno de enfermeria y boton del censo que crea o abre la planilla de entrega medica en
Google Drive. La vista medica antigua dentro de la app (notas por paciente, firma y envio por
WhatsApp) se retiro; un enlace viejo a `/medical-handoff` abre el censo.

## Decision Guide

- Superficies runtime y puntos de cambio seguros: [docs/ADR_HANDOFF_RUNTIME_SURFACES.md](../../../docs/ADR_HANDOFF_RUNTIME_SURFACES.md)
- Checklist transversal de cambio seguro: [docs/CI_GATES_AND_FAILURE_RUNBOOKS.md](../../../docs/CI_GATES_AND_FAILURE_RUNBOOKS.md)

## Estructura

- `components/`: shell visual y vistas de handoff.
- `hooks/`: screen models/runtime hooks para aislar wiring grande de las vistas.
- `controllers/`: policies de pantalla y adapters internos del feature.
- `domain/handoff`: reglas puras de management, checklist y contratos de registro y paciente.

## Contratos principales

- La logica de negocio nueva entra en `domain/handoff`.
- Los controllers de pantalla (`handoffViewController`, `clinicalEventsPanelController`)
  concentran wiring puro,
  presentation policy y payload normalization; la UI no debe reabsorber esas decisiones.
- El source productivo no debe importar el barrel `features/handoff/controllers`.

## Invariantes

- Los read models de pantalla deben alimentar la UI; no reinyectar decisiones de negocio en `.tsx`.
- `HandoffView.tsx` debe mantenerse presentacional: lee todo su estado de un solo hook,
  `useHandoffViewScreenModel` (registro, personal, camas visibles, nota, eventos clinicos, auditoria
  de vista y `document.title`), que toma sus decisiones puras de `handoffViewController.ts`.
- Quien puede abrir y editar la entrega lo decide el router con su predicado de acceso
  (`readOnly`); la pantalla no vuelve a decidir por rol.
- `ClinicalEventsPanel.tsx` debe limitarse a estado local de UI; sorting, defaults y normalizacion
  del formulario deben salir por `clinicalEventsPanelController.ts`.
- Las filas de la entrega se identifican por paciente y episodio, no solo por cama: una nota escrita
  para un paciente nunca se guarda en el que ocupa la cama despues.
- El permiso `MEDICAL_HANDOFF` ya no abre una pantalla: solo muestra el boton de la planilla en el censo.

## Lo que queda del sistema antiguo

La cola de notas de especialista y la fusion de campos medicos (etapa c), y las Functions de firma y
de notas de especialista con sus reglas (etapa d), siguen activas hasta que se retiren en sus etapas.
Nada en la app las invoca ya. Los dias pasados conservan sus campos medicos y su firma, que sigue
protegiendo CUDYR y las correcciones de dias anteriores.

## Entry points recomendados

- `src/features/handoff/hooks/useHandoffManagement.ts`
- `src/features/handoff/domain/management.ts`
- `src/features/handoff/services/attributionService.ts`
- `src/features/handoff/public.ts`

## Controllers activos recomendados

- [handoffViewController.ts](controllers/handoffViewController.ts)
  para titulo, audit descriptor, camas y pacientes visibles, nota de enfermeria y bindings del shell.
- [clinicalEventsPanelController.ts](controllers/clinicalEventsPanelController.ts)
  para defaults, sorting y payload del panel de eventos clinicos.

El consumo externo a la feature debe entrar por `@/features/handoff`. Los imports profundos a
`components/`, `controllers/`, `hooks/` o bridges internos quedan reservados para implementación
interna del feature.

## CUDYR registrado y elegibilidad

La impresión CUDYR conserva una categoría importada válida del censo/turno aun
cuando el paciente no sea elegible: muestra «Registrado» y la exclusión juntos.
`isEligible` sigue controlando los puntajes manuales visibles y el denominador de
`buildCudyrPrintMetrics`; ni un resultado desfasado ni una categoría inválida se
presentan como registro válido. Esto aplica CUD-02/CUD-07 sólo en el límite de handoff.

## Checks recomendados

- `npm exec -- vitest run src/tests/hooks/useHandoffManagement.test.ts src/tests/domain/handoff`
- `npx vitest run src/tests/views/handoff`
- `npm run check:quality`
- `npm run typecheck`
