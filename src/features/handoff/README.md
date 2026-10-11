# `src/features/handoff`

## Proposito

Entrega de turno de enfermeria y medicos, con flujos de gestion, delivery y handoff medico por paciente.

## Decision Guide

- Superficies runtime y puntos de cambio seguros: [docs/ADR_HANDOFF_RUNTIME_SURFACES.md](../../../docs/ADR_HANDOFF_RUNTIME_SURFACES.md)
- Checklist transversal de cambio seguro: [docs/SAFE_CHANGE_CHECKLIST.md](../../../docs/SAFE_CHANGE_CHECKLIST.md)
- Ruta productiva del write medico de especialista: [docs/HANDOFF_SPECIALIST_MEDICAL_WRITE_PATH.md](../../../docs/HANDOFF_SPECIALIST_MEDICAL_WRITE_PATH.md)

## Estructura

- `components/`: shell visual y vistas de handoff.
- `hooks/`: screen models/runtime hooks para aislar wiring grande de las vistas.
- `controllers/`: policies de pantalla y adapters internos del feature.
- `application/handoff`: use cases y read models del contexto.
- `domain/handoff`: reglas puras de entries, management y vistas.

## Contratos principales

- La logica de negocio nueva entra en `application/handoff` o `domain/handoff`.
- Los controllers de pantalla (`handoffViewController`, `handoffViewBindingsController`,
  `handoffMedicalContentController`, `clinicalEventsPanelController`) concentran wiring puro,
  presentation policy y payload normalization; la UI no debe reabsorber esas decisiones.
- Los resultados operativos de gestion y delivery deben salir como `ApplicationOutcome`.
- El source productivo no debe importar el barrel `features/handoff/controllers`.

## Invariantes

- El mirroring legacy de ciertos campos medicos debe preservarse mientras existan consumers antiguos.
- Los read models de pantalla deben alimentar la UI; no reinyectar decisiones de negocio en `.tsx`.
- `HandoffView.tsx` debe mantenerse presentacional; la coordinacion de contexts, auth, audit y
  bindings de pantalla debe salir por hooks locales del feature como `useHandoffViewScreenModel`.
- `useHandoffViewScreenModel` no debe volver a mezclar efectos de auditoria, `document.title`,
  rules de read-only e inicializacion desde URL en el mismo bloque sin controller intermedio.
- `ClinicalEventsPanel.tsx` debe limitarse a estado local de UI; sorting, defaults y normalizacion
  del formulario deben salir por `clinicalEventsPanelController.ts`.
- Los flows de firma, continuidad y patient entries deben seguir auditando con payload compatible.
- Cuando una entrega medica se copia al dia siguiente, el contenido se hereda pero la vigencia diaria no:
  `currentStatus*` debe reiniciarse para que la UI muestre "pendiente hoy" hasta nueva confirmacion
  o actualizacion del especialista.
- `doctor_specialist` puede editar solo la entrega del dia actual; dias previos deben quedar en solo lectura
  tanto en la UI como en la capa de mutacion.
- El handoff medico por paciente/cama del especialista ya no depende de un write directo a
  Firestore Rules; usa una callable backend acotada y validada por rol.

## Firma pública

`getMedicalHandoffSignaturePayload` valida el token entrante y devuelve una proyección
médica construida con allowlists en servidor, no el censo persistido. Filtra camas con
la clasificación UPC efectiva y conserva la cuna clínica de la cama incluida. Nunca
devuelve tokens, notas de enfermería, movimientos, FHIR ni datos de sincronización.
Las notas médicas globales/de especialidad no se pueden atribuir a un alcance de camas:
se muestran sólo en enlaces `all`. Firma y timestamp se limitan al alcance solicitado.

`submitMedicalHandoffSignature` revalida token y firma dentro de una transacción.
Firma y auditoría se confirman juntas; un envío simultáneo del mismo alcance recibe
la firma ya aceptada, sin sustituirla ni duplicar la auditoría. El alcance `all`
mantiene el campo legacy `medicalSignature`; alcances distintos conservan sus firmas.

## Ruta especialista

Cuando el usuario actual es `doctor_specialist` y el patch toca solo una cama con campos medicos
permitidos, el flujo productivo esperado es:

1. optimistic update local en cache/query;
2. dispatch del patch acotado desde `useHandoffLogic`;
3. deteccion de patch especialista en `firestoreRecordWrites.ts`;
4. llamada a `updateSpecialistMedicalHandoff`;
5. reconciliacion realtime que no debe reemplazar el cache local con snapshots mas viejos.

Detalles, limites y errores historicos documentados en:

- [docs/HANDOFF_SPECIALIST_MEDICAL_WRITE_PATH.md](../../../docs/HANDOFF_SPECIALIST_MEDICAL_WRITE_PATH.md)

## Entry points recomendados

- `src/application/handoff`
- `src/domain/handoff/management.ts`
- `src/domain/handoff/patientEntries.ts`
- `src/domain/handoff/patientEntryMutations.ts`
- `src/domain/handoff/patientView.ts`
- `src/domain/handoff/view.ts`
- `src/domain/handoff/scope.ts`
- `src/features/handoff/public.ts`

## Controllers activos recomendados

- [handoffViewController.ts](controllers/handoffViewController.ts)
  para frame de pantalla, audit descriptor y bindings del shell.
- [handoffViewBindingsController.ts](controllers/handoffViewBindingsController.ts)
  para acciones medicas y eventos clinicos con gating por capabilities.
- [handoffMedicalContentController.ts](controllers/handoffMedicalContentController.ts)
  para filtros/chips y links de handoff medico.
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
- `npm run check:handoff-context-boundaries`
- `npm run check:quality`
- `npm run typecheck`
