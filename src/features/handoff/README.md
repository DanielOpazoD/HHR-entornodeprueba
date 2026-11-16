# `src/features/handoff`

## Proposito

Entrega de turno de enfermeria y boton del censo que crea o abre la planilla de entrega medica en
Google Drive. La vista medica antigua dentro de la app (notas por paciente, firma y envio por
WhatsApp) se retiro; un enlace viejo a `/medical-handoff` abre el censo.

## Decision Guide

- Superficies runtime y puntos de cambio seguros: [docs/ADR_HANDOFF_RUNTIME_SURFACES.md](../../../docs/ADR_HANDOFF_RUNTIME_SURFACES.md)
- Checklist transversal de cambio seguro: [docs/SAFE_CHANGE_CHECKLIST.md](../../../docs/SAFE_CHANGE_CHECKLIST.md)

## Estructura

- `components/`: shell visual y vistas de handoff.
- `hooks/`: screen models/runtime hooks para aislar wiring grande de las vistas.
- `controllers/`: policies de pantalla y adapters internos del feature.
- `application/handoff`: use cases y read models del contexto.
- `domain/handoff`: reglas puras de management, checklist y contratos de registro y paciente.

## Contratos principales

- La logica de negocio nueva entra en `application/handoff` o `domain/handoff`.
- Los controllers de pantalla (`handoffViewController`, `handoffViewBindingsController`,
  `clinicalEventsPanelController`) concentran wiring puro,
  presentation policy y payload normalization; la UI no debe reabsorber esas decisiones.
- Los resultados operativos de gestion deben salir como `ApplicationOutcome`.
- El source productivo no debe importar el barrel `features/handoff/controllers`.

## Invariantes

- Los read models de pantalla deben alimentar la UI; no reinyectar decisiones de negocio en `.tsx`.
- `HandoffView.tsx` debe mantenerse presentacional; la coordinacion de contexts, auth, audit y
  bindings de pantalla debe salir por hooks locales del feature como `useHandoffViewScreenModel`.
- `useHandoffViewScreenModel` no debe volver a mezclar efectos de auditoria, `document.title`,
  rules de read-only e inicializacion desde URL en el mismo bloque sin controller intermedio.
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

- `src/application/handoff`
- `src/domain/handoff/management.ts`
- `src/features/handoff/public.ts`

## Controllers activos recomendados

- [handoffViewController.ts](controllers/handoffViewController.ts)
  para frame de pantalla, audit descriptor y bindings del shell.
- [handoffViewBindingsController.ts](controllers/handoffViewBindingsController.ts)
  para las acciones de eventos clinicos segun permiso de edicion.
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

- `npm exec -- vitest run src/tests/application/handoff src/tests/domain/handoff src/tests/hooks/controllers`
- `npx vitest run src/tests/views/handoff`
- `npm run check:quality`
- `npm run typecheck`
