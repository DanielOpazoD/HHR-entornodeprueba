# `src/features/census`

## Propósito

Módulo central del producto: censo diario, acciones sobre camas/pacientes, movimientos (alta/traslado/move-copy), UI de tablas y reglas de turno/fecha.

## Subcapas internas

| Path           | Rol                                                      |
| -------------- | -------------------------------------------------------- |
| `components/`  | UI del censo (tabla, filas, modales, secciones)          |
| `hooks/`       | Orquestación de estado y acciones de la feature          |
| `controllers/` | Lógica pura (validación, mapping, ejecución de comandos) |
| `domain/`      | Contratos de movimientos y reglas propias                |
| `context/`     | Contextos internos de acciones de censo                  |
| `types/`       | Tipos internos del módulo                                |
| `validation/`  | Validaciones específicas de acciones de censo            |

## Ownership de controllers

- `src/features/census/controllers` es la fuente de verdad para controllers propios de `census`.
- Si un consumer histórico importa el mismo basename desde `src/hooks/controllers`, ese archivo existe solo como shim de compatibilidad.
- Nuevos cambios en controllers de `census` deben entrar por la ruta de la feature.

## API pública mínima

- Código fuera de `src/features/census/**` debe consumir `census` solo desde `@/features/census`.
- `src/features/census/index.ts` reexporta `public.ts` y es el único entrypoint externo soportado para código productivo.
- Imports directos a `components/`, `hooks/`, `controllers/`, `contracts/`, `types/` o `context/` desde fuera de la feature se consideran saltos de boundary.
- Excepción intencional: `src/tests/**` puede importar internals para testear unidades puras; `src/hooks/controllers/**` mantiene shims históricos mientras exista compatibilidad de transición.

## Flujos críticos

### Acción de movimiento

```text
UI modal -> use*ModalForm -> controller validation
-> resolve*Command -> execute*RuntimeCommand
-> actions DailyRecord -> persistencia
```

### Reglas de fecha/turno

```text
clinicalShiftCalendarController
  -> bounds (recordDate / nextDay / nightEnd)
  -> validation (movementDate + movementTime)
  -> presentation (dateLabel + timeLabel)
```

### Launcher orbital de acciones clínicas

```text
hover/focus fila ocupada
  -> PatientRowOrbitalQuickActions
  -> usePatientRowOrbitalLauncherRuntime
  -> portal fuera de la tabla
  -> 4 acciones rápidas: documentos / laboratorio / imágenes / indicaciones médicas
```

- El launcher orbital vive visualmente fuera del borde izquierdo de la tabla, aunque se ancla a la fila del paciente.
- Expone accesos rápidos clínicos: `Documentos clínicos`, `Solicitud Exámenes`, `Solicitud de Imágenes` e `Indicaciones Médicas` (manutara).
- El panel clásico conserva la gestión clínica histórica (`Dar de Alta`, `Trasladar`, `Egreso CMA`) y no debe duplicar estas aperturas rápidas.
- En desktop aparece por `hover` de la fila o del área externa del launcher; en touch permanece visible.
- Solo un launcher puede permanecer activo a la vez para no perder foco visual al recorrer otras filas.
- La iconografía cultural del launcher se define en `components/patient-row/patientRowOrbitalQuickActionAssets.ts`.

#### Arquitectura de pointer-events

El launcher usa un esquema de capas CSS que evita interceptar clics destinados a la tabla subyacente:

- El **wrapper** del portal se renderiza con `pointer-events-none` para que los clics lo atraviesen hacia la tabla.
- El **contenedor de acciones** y el **trigger** activan `pointer-events-auto` para capturar solo los clics sobre los botones del launcher.
- Capas de z-index: backdrop `z-[38]`, wrapper `z-[39]`, acciones internas `z-10`. El launcher queda sobre el encabezado y acciones de la tabla (`z-30`/`z-[36]`) y bajo las barras sticky de navegación/fecha (`z-40`/`z-60`).

#### Fix de stale closures en grace timer

El runtime del launcher usa refs para leer el estado actual dentro del grace timer, evitando closures obsoletos:

- El grace timer que retrasa el cierre del launcher lee el estado desde refs (`useRef`) en lugar de capturar valores por closure.
- Un listener de `visibilitychange` resetea el estado de hover cuando el tab pasa a background, evitando que el launcher quede abierto al volver.

#### Constantes de timing

| Constante              | Valor  | Propósito                                                        |
| ---------------------- | ------ | ---------------------------------------------------------------- |
| `REVEAL_DELAY_MS`      | 0 ms   | Apertura instantánea al hacer hover sobre la fila                |
| `CLOSE_RESET_DELAY_MS` | 50 ms  | Delay mínimo antes de resetear el estado de cierre               |
| `HOVER_EXIT_GRACE_MS`  | 120 ms | Gracia antes de cerrar al salir del hover (evita flicker casual) |

### Acción de fuga por correo

```text
egreso tipo Fuga
  -> DischargeRowView
  -> FugaNotificationModal
  -> useFugaNotificationModalModel
  -> fugaNotificationPolicyController
  -> send-fuga-notification
  -> Gmail
```

- La acción `FUGA` solo aparece para egresos cuyo tipo es `Fuga`.
- Psiquiatría usa destinatarios automáticos resueltos en backend.
- `admin` puede usar `modo prueba`; enfermería no.

### IEEH orientado a impresión

```text
botón IEEH
  -> IEEHFormDialog
  -> useIEEHForm
  -> ieehFormDataController
  -> ieehPdfService
  -> pdfBase.openPdfPrintDialog
```

- El flujo IEEH ya no se modela como descarga directa.
- La preparación del formulario se mantiene separada de la lógica de impresión del PDF.

## Archivos clave

| Archivo                                                         | Motivo                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `controllers/clinicalShiftCalendarController.ts`                | Fuente única de invariantes de fecha/turno                      |
| `controllers/censusActionExecutionController.ts`                | Resolución de comandos tipados                                  |
| `controllers/censusActionRuntimeController.ts`                  | Ejecución runtime desacoplada de provider                       |
| `controllers/patientMovementCommandRuntimeController.ts`        | Bridge command -> action runtime                                |
| `controllers/bedManagerModalController.ts`                      | Transiciones y validación del flujo de bloqueo de camas         |
| `controllers/bedManagerGridItemsController.ts`                  | Mapeo puro de `DailyRecord` a props de grillas de camas         |
| `controllers/censusMovementActionIconController.ts`             | Resolución de iconografía para acciones de movimientos          |
| `components/patient-row/nameInputController.ts`                 | Contrato puro de display/edición del nombre del paciente        |
| `hooks/useDischargeModalForm.ts`                                | Form flow de altas                                              |
| `hooks/useTransferModalForm.ts`                                 | Form flow de traslados                                          |
| `hooks/useBedManagerModalModel.ts`                              | Orquestación UI vs dominio del modal de camas                   |
| `hooks/useCensusMovementActionsCellModel.ts`                    | View-model para celda de acciones de movimientos                |
| `hooks/useCensusViewScreenModel.ts`                             | Fachada de pantalla para ramas `empty/register`                 |
| `hooks/useCensusTableRuntime.ts`                                | Runtime unificado de tabla (dependencias + resize + activación) |
| `hooks/useDischargesSectionModel.ts`                            | Fachada de wiring para altas                                    |
| `hooks/useTransfersSectionModel.ts`                             | Fachada de wiring para traslados                                |
| `components/patient-row/PatientRowOrbitalQuickActions.tsx`      | Launcher portalizado de acciones clínicas rápidas               |
| `components/patient-row/usePatientRowOrbitalLauncherRuntime.ts` | Runtime UI del launcher orbital                                 |
| `components/patient-row/patientRowOrbitalQuickActionAssets.ts`  | Mapeo de assets culturales del launcher                         |
| `components/FugaNotificationModal.tsx`                          | Modal de notificación de fuga por correo                        |
| `hooks/useFugaNotificationModalModel.ts`                        | Orquestación UI del envío de fuga                               |
| `controllers/fugaNotificationPolicyController.ts`               | Política compartida de destinatarios y validación de fuga       |
| `controllers/ieehFormDataController.ts`                         | Serialización pura del formulario IEEH                          |

## Calidad

- Cobertura alta en `src/tests/views/census/**`.
- Checks de arquitectura y boundaries runtime en CI local (`check:quality`).
- Los tipos compartidos de camas y movimientos deben entrar por
  `contracts/censusBedContracts.ts` y `contracts/censusMovementContracts.ts`,
  no directo desde `src/types/domain/*`.

## Invariantes

- El cálculo de `nuevo ingreso` debe salir del dominio temporal compartido, no de helpers locales de tabla.
- Los indicadores clínicos de fila deben depender del sujeto correcto: paciente/episodio cuando corresponda, no cama por arrastre.
- Los modales visibles deben derivar de capabilities/runtime de fila, no solo de estado UI.
- En pacientes con especialidad `Ginecobstetricia`, la UI del censo puede capturar un
  `ginecobstetriciaType` adicional (`Obstétrica` o `Ginecológica`) sin modificar la especialidad
  principal usada en el registro.
- El ícono de vía del parto solo debe aparecer para registros `Ginecobstetricia` marcados como
  `Obstétrica`.
- `deliveryRoute` y `deliveryCesareanLabor` son persistencia clínica del censo, no señalización visual;
  si el caso deja de ser obstétrico, esos campos deben limpiarse.
- La creación manual de un día con copia desde el anterior sigue respetando el horario clínico salvo
  cuando el actor es `admin` y usa el override explícito; ese bypass no debe reutilizarse para otros roles.
- La verificación pasiva de respaldos remotos no debe ejecutarse para roles sin capacidad operativa
  real sobre el módulo, para evitar `403` ruidosos desde Storage.
- Los warnings de creación de día deben distinguir entre `bloqueado por horario`, `permitido por override`
  y `falla real de inicialización`.
- El bootstrap de migración del censo es pasivo y no crítico: debe correr fuera del render inicial
  de `CensusView` y nunca bloquear la primera pintura del registro o del prompt de día vacío.
- `useCensusViewRouteModel` debe construir props solo para la rama visible (`empty`, `register`)
  para mantener bajo el costo sincrónico del primer render del censo.
- Los componentes grandes (`CensusView`, `DischargesSection`, `TransfersSection`) deben preferir
  facades locales de feature (`use*ScreenModel`, `use*SectionModel`, `use*Runtime`) en vez de
  recomponer dependencias de contexto y acciones manualmente en cada render.

## Runtime boundaries

- `controllers/` no debe importar React ni hooks.
- `hooks/controllers` no debe volver a alojar implementaciones paralelas de controllers dueños de `census`.
- `components/` no debe recalcular reglas clínicas ya resueltas por controllers.
- Las acciones del censo deben salir de los command/runtime controllers, no de callbacks ad hoc embebidos.
- Fuera de la feature, el acceso permitido es `@/features/census`; cualquier subruta interna queda reservada al módulo.
- La tabla web puede abreviar visualmente especialidades concretas como `GyO` o `TMT`, pero esas
  etiquetas no deben filtrarse a persistencia ni contratos de dominio del censo.
- El formateo de fechas compactas de `census` debe reutilizar presentation helpers compartidos;
  no deben reaparecer `toLocaleDateString()` o `toLocaleString()` inline en controllers de UI.

## Test entrypoints recomendados

- `npx vitest run src/tests/views/census`
- `npx vitest run src/tests/views/census/PatientRowOrbitalQuickActions.test.tsx src/tests/views/census/patientRowOrbitalQuickActionsController.test.ts`
- `npm run test:ci:unit`

## Comandos de validación del módulo

- `npm run typecheck`
- `npm run check:quality`
- `npm run test:ci:unit -- src/tests/views/census`

## Safe change links

- [docs/QUALITY_GUARDRAILS.md](../../../docs/QUALITY_GUARDRAILS.md)
- [docs/SAFE_CHANGE_CHECKLIST.md](../../../docs/SAFE_CHANGE_CHECKLIST.md)
