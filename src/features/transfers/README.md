# `src/features/transfers`

## Propósito

Módulo de gestión de traslados clínicos. Cubre el ciclo completo de la solicitud:

- creación y edición
- cambio de estado
- cancelación y traslado efectivo
- segmentación entre casos activos y finalizados
- preparación y visualización de documentos por hospital

Este módulo es una bitácora operacional de enfermería para seguimiento en tiempo real. Los datos
estadísticos institucionales salen del censo diario y sus movimientos, no de `transferRequests`.

## Flujo funcional

### Estados activos

- `REQUESTED`
- `RECEIVED`
- `ACCEPTED`

Estos casos aparecen en la tabla principal y siguen abiertos a edición operativa.

La visibilidad de activos es mensual: una solicitud abierta creada en marzo pertenece a marzo y no
debe arrastrarse automáticamente a abril o meses posteriores. Si se revisa un mes histórico, se ven
las solicitudes abiertas creadas en ese mes, aunque hayan quedado sin cierre operativo.

### Estados finalizados

- `TRANSFERRED`
- `REJECTED`
- `CANCELLED`
- `NO_RESPONSE`

Estos casos aparecen en la sección colapsable de finalizados para el mes seleccionado.

Cuando un traslado se registra desde Censo Diario sin solicitud previa en este módulo, el sistema
crea una solicitud con la fecha del movimiento y la finaliza inmediatamente como `TRANSFERRED`.
Si ya existe una solicitud abierta para la misma cama y el mismo mes operativo, esa solicitud se
finaliza en vez de crear otra. No se debe completar una solicitud abierta de otro mes solo porque
coincida la cama.

## Estructura interna

```text
transfers/
├── components/
│   ├── TransferManagementView.tsx
│   ├── controllers/
│   │   ├── transferFormController.ts
│   │   ├── transferManagementViewController.ts
│   │   ├── transferNotesController.ts
│   │   └── transferTableController.ts
│   └── components/
│       ├── TransferTable.tsx
│       ├── TransferTableRow.tsx
│       ├── TransferNotesCell.tsx
│       ├── TransferTableRowActions.tsx
│       └── TransferDocumentPackageModal.tsx
├── controllers/
│   └── transferStatusInteractionController.ts
├── hooks/
│   └── useTransferSubscriptions.ts
├── services/
│   └── destinationHospitalCatalogService.ts
└── utils/
    └── localDate.ts
```

La persistencia y sincronización operativa de traslados vive en:

- [transferService.ts](../../services/transfers/transferService.ts)
- [transferQueriesService.ts](../../services/transfers/transferQueriesService.ts)
- [transferMutationsService.ts](../../services/transfers/transferMutationsService.ts)
- [transferSubscriptionsService.ts](../../services/transfers/transferSubscriptionsService.ts)
- [transferStatusController.ts](../../services/transfers/transferStatusController.ts)

`transferService.ts` debe mantenerse como fachada pública. La lógica nueva debe entrar en estas capas internas, no volver a crecer dentro de la fachada.

## Responsabilidades clave

### `TransferManagementView.tsx`

- orquesta modales y wiring del feature
- consume el runtime del feature
- no debe volver a absorber lógica pura de filtrado o normalización

El filtrado por período y la separación entre activos/finalizados se centralizan en:

- [transferManagementViewController.ts](components/controllers/transferManagementViewController.ts)

### `TransferTable.tsx`

- layout tabular
- confirmación de borrado
- menú de cierre por fila

La policy de estados y acciones no vive aquí; se centraliza en:

- [transferTableController.ts](components/controllers/transferTableController.ts)

La gestión inline de notas se mantiene aislada en:

- [TransferNotesCell.tsx](components/internal/TransferNotesCell.tsx)
- [transferNotesController.ts](components/controllers/transferNotesController.ts)

### `TransferFormModal.tsx`

- renderiza el formulario y conecta eventos de UI
- no debe volver a concentrar validación, normalización de catálogos ni armado del payload

La inicialización y validación del formulario se centralizan en:

- [transferFormController.ts](components/controllers/transferFormController.ts)

### `useTransferViewStates.ts`

Hook orquestador de UX para:

- modales del flujo
- selección de traslado activo
- apertura de cuestionario
- apertura del paquete documental

La preparación/caché de documentos se apoya en:

- [transferDocumentPackageController.ts](../../hooks/controllers/transferDocumentPackageController.ts)

### `useTransferSubscriptions.ts`

- encapsula suscripción realtime
- separa `transfers`, `isLoading` y `error`
- evita que `useTransferManagement` tenga que manejar directamente snapshots de Firestore

## Documentos y hospitales

Hoy el soporte documental real está habilitado para:

- Hospital del Salvador

Si un hospital no tiene configuración documental:

- `Preparar docs` y `Ver docs` se deshabilitan
- la tabla muestra el hospital, pero no permite flujo documental

### Modo oculto de paquete documental

- El flujo de paquete documental sigue existiendo en el feature:
  - [TransferDocumentPackageModal.tsx](components/internal/TransferDocumentPackageModal.tsx)
  - `onGenerateDocs` / persistencia de `questionnaireResponses`
- El botón de tabla `Preparar docs` está oculto intencionalmente del UI público.
- Si se vuelve a habilitar, debe hacerse reusando la capacidad existente y no recreando otro modal o flujo paralelo.

## Regla de visualización

- la tabla principal no debe usar scroll lateral
- los modales deben evitar scroll interno cuando el contenido cabe
- los textos largos se parten en múltiples líneas en vez de forzar una sola línea

## Reglas de mantenimiento

1. La separación de estados activos/finalizados debe seguir usando la policy compartida del controller.
2. El estado de ciclo de vida de traslados debe seguir saliendo de [transferStatusController.ts](../../services/transfers/transferStatusController.ts), no de listas duplicadas en hooks o componentes.
3. `transferService.ts` no debe volver a mezclar queries, mutaciones, normalización y suscripción en un solo archivo.
4. La suscripción realtime debe exponer error legible al consumidor, aunque el UI decida no mostrarlo.
5. Los cambios en documentos de traslado deben mantener el comportamiento:
   - el modo oculto de `Preparar docs` persiste respuestas
   - `Ver docs` reutiliza el paquete ya generado dentro de la sesión si la firma no cambió
6. La fecha de solicitud debe manejarse con fecha local, no UTC.
7. Si se agregan nuevos hospitales con plantillas, actualizar la configuración documental y los tests del flujo.
8. La capacidad para preparar o abrir documentos debe salir de policies compartidas
   (`operationalAccessPolicy`) y no de checks inline por componente o fila.
9. Las fechas visibles de estados/modales/documentos deben reutilizar presentation helpers
   compartidos; no deben reaparecer variantes locales de `toLocaleDateString()`.
10. Las notas inline deben seguir usando [transferNotesController.ts](components/controllers/transferNotesController.ts) para sorting/permisos y no reintroducir estado repetido dentro de la fila.
11. El formulario de traslado debe construir y validar su payload a través de [transferFormController.ts](components/controllers/transferFormController.ts), no con validaciones duplicadas dentro del modal.
12. Las búsquedas de solicitud abierta disparadas desde Censo Diario deben acotarse al mes de la
    fecha de movimiento; no basta buscar por cama.

## Tests relevantes

- [TransferManagementView.grouping.test.tsx](../../tests/features/transfers/TransferManagementView.grouping.test.tsx)
- [TransferManagementView.notes-inline.test.tsx](../../tests/features/transfers/TransferManagementView.notes-inline.test.tsx)
- [transferManagementViewController.test.ts](../../tests/features/transfers/transferManagementViewController.test.ts)
- [useTransferSubscriptions.test.ts](../../tests/features/transfers/useTransferSubscriptions.test.ts)
- [TransferFormModal.test.tsx](../../tests/features/transfers/TransferFormModal.test.tsx)
- [transferFormController.test.ts](../../tests/features/transfers/transferFormController.test.ts)
- [transferNotesController.test.ts](../../tests/features/transfers/transferNotesController.test.ts)
- [transferTableController.test.ts](../../tests/features/transfers/transferTableController.test.ts)
- [transferStatusController.test.ts](../../tests/services/transfers/transferStatusController.test.ts)
- [transferSubscriptionController.test.ts](../../tests/services/transfers/transferSubscriptionController.test.ts)
- [useTransferViewStates.document-package.test.ts](../../tests/hooks/useTransferViewStates.document-package.test.ts)
- [useTransferViewStates.modal-state.test.ts](../../tests/hooks/useTransferViewStates.modal-state.test.ts)
- [transferDocumentPackageController.test.ts](../../tests/hooks/controllers/transferDocumentPackageController.test.ts)

## Runtime boundaries

- `transferService.ts` sigue siendo la fachada pública; lógica nueva entra en queries, mutations, status o subscriptions.
- El consumo externo del feature debe entrar por `@/features/transfers`; evitar imports profundos a
  `components/`, `hooks/`, `services/` o `utils/` desde fuera del módulo.
- La vista de management no debe volver a mezclar filtros de período, lifecycle y wiring de modales en un solo componente.
- Las fallas realtime deben mapearse a error operativo estructurado + telemetría, no solo a `console.error`.
- Los generadores DOCX y templates deben reutilizar helpers compartidos de fecha; no deben volver a
  introducir variantes locales de `toLocaleDateString()` por documento o template.
- Los estados degradados del flujo documental o de upload deben mapearse a notices explícitos
  (`info`/`warning`/`error`) y no a mensajes armados inline dentro de modales o hooks de vista.
- Las mutaciones de traslado deben devolver mensajes usuario-seguros estructurados para `not_found`,
  `permission_denied` y `conflict`; los wrappers throw-based solo quedan como compatibilidad.

## Comandos de validación del módulo

- `npm run typecheck`
- `npm run check:quality`
- `npx vitest run src/tests/features/transfers src/tests/services/transfers`

## Safe change links

- [docs/QUALITY_GUARDRAILS.md](../../../docs/QUALITY_GUARDRAILS.md)
- [docs/SAFE_CHANGE_CHECKLIST.md](../../../docs/SAFE_CHANGE_CHECKLIST.md)
