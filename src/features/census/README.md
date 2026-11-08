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

### Columna «Accesos»

```text
fila con paciente
  -> PatientInputCells (celda entre Paciente y Diagnóstico)
  -> PatientClinicalAccess: una tablilla rongorongo por paciente
  -> ClinicalAccessRadialMenu: anillo con ficha clínica / laboratorio / imágenes / documentos y, al centro, el explorador clínico
  -> PatientClinicalTopicSurfaces: panel lateral, visor de laboratorio, visor MMRAD
```

- Es la única puerta clínica de la fila y siempre ocupa el mismo lugar: cada tema abre una ventana donde se lee y, si la fila puede editar, se solicita. Laboratorio e Imágenes abren su visor con «Solicitar exámenes» o «Solicitar imagen».
- Los permisos salen de los mismos controladores que el menú de la fila (`buildPatientClinicalAccessBinding`): los temas de lectura aparecen también en un censo de solo lectura; las solicitudes, no.
- Sin episodio o con pasaporte no hay resultados que leer: si la fila puede editar, Laboratorio e Imágenes abren directo la solicitud. Un tema que no aplica queda gris en el anillo, que nunca cambia de forma.
- Ficha clínica abre el panel lateral (`ClinicalPanelTrigger`, sin botón propio); sus flechas ‹ › recorren las marcas `data-clinical-panel-key`, incluida la cuna. El centro del anillo abre el explorador clínico en ese paciente; el panel también lo ofrece.
- El anillo sigue a su botón si la página se desplaza y se cierra con Esc, con un clic fuera o cuando el botón sale de la pantalla; devuelve el foco al botón. Las flechas eligen el sector que señalan.
- Una cuna ofrece solo su ficha. La impresión deja fuera la columna.
- La tablilla rongorongo es el único ícono rapanui de la columna (`components/patient-row/patientClinicalAccessIcons.ts`); los temas usan los íconos habituales del censo.

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

### IEEH

El IEEH ya no se completa desde el censo: se llena en el panel IEEH de la epicrisis
(`src/features/clinical-documents`) y se imprime con `ieehPdfService`. Ver
[docs/features/ieeh-pdf-flow.md](../../../docs/features/ieeh-pdf-flow.md).

- La preparación del formulario se mantiene separada de la lógica de impresión del PDF.

## Archivos clave

| Archivo                                                  | Motivo                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| `controllers/clinicalShiftCalendarController.ts`         | Fuente única de invariantes de fecha/turno                      |
| `controllers/censusActionExecutionController.ts`         | Resolución de comandos tipados                                  |
| `controllers/censusActionRuntimeController.ts`           | Ejecución runtime desacoplada de provider                       |
| `controllers/patientMovementCommandRuntimeController.ts` | Bridge command -> action runtime                                |
| `controllers/bedManagerModalController.ts`               | Transiciones y validación del flujo de bloqueo de camas         |
| `controllers/bedManagerGridItemsController.ts`           | Mapeo puro de `DailyRecord` a props de grillas de camas         |
| `components/censusMovementActionPresentation.tsx`        | Iconografía y estilo compartidos de acciones de movimientos     |
| `components/patient-row/nameInputController.ts`          | Contrato puro de display/edición del nombre del paciente        |
| `src/hooks/useDischargeModalForm.ts`                     | Form flow de altas                                              |
| `src/hooks/useTransferModalForm.ts`                      | Form flow de traslados                                          |
| `src/hooks/useBedManagerModalModel.ts`                   | Orquestación UI vs dominio del modal de camas                   |
| `hooks/useCensusMovementActionsCellModel.ts`             | View-model para celda de acciones de movimientos                |
| `hooks/useCensusViewScreenModel.ts`                      | Fachada de pantalla para ramas `empty/register`                 |
| `hooks/useCensusTableRuntime.ts`                         | Runtime unificado de tabla (dependencias + resize + activación) |
| `hooks/useDischargesSectionModel.ts`                     | Fachada de wiring para altas                                    |
| `hooks/useTransfersSectionModel.ts`                      | Fachada de wiring para traslados                                |
| `components/patient-row/PatientClinicalAccess.tsx`       | Columna «Accesos»: rongorongo y temas clínicos del paciente     |
| `components/patient-row/ClinicalAccessRadialMenu.tsx`    | Anillo de temas alrededor del explorador clínico                |
| `components/patient-row/patientClinicalAccessIcons.ts`   | El ícono rongorongo de la columna «Accesos»                     |
| `components/FugaNotificationModal.tsx`                   | Modal de notificación de fuga por correo                        |
| `hooks/useFugaNotificationModalModel.ts`                 | Orquestación UI del envío de fuga                               |
| `controllers/fugaNotificationPolicyController.ts`        | Política compartida de destinatarios y validación de fuga       |

## Calidad

- Cobertura alta en `src/tests/views/census/**`.
- Checks de arquitectura y boundaries runtime en CI local (`check:quality`).
- Los tipos compartidos de camas y movimientos deben entrar por
  `contracts/censusBedContracts.ts` y `contracts/censusMovementContracts.ts`,
  no directo desde `src/types/domain/*`.
- Los límites y significados visuales de signos vitales están documentados en
  [`docs/VITAL_SIGNS_VISUAL_RANGES.md`](../../../docs/VITAL_SIGNS_VISUAL_RANGES.md); su configuración
  ejecutable compartida vive en `src/constants/vitalSignsThresholds.ts`.

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

## Presentación compacta del censo

- Nombre y diagnóstico usan superficies neutras en reposo; hover, foco y errores siguen visibles.
  Los nombres se ajustan a varias líneas sin elipsis y el documento permanece en una sola línea.
- Las camas vacías siguen despejadas: el ingreso aparece al pasar el cursor o recibir foco.
- Signos usan una cuadrícula estable; los valores alterados conservan su color, detalle textual y
  un subrayado punteado. Las escalas alinean resultado y vencimiento sin colorear todo el control.
- Enfermería, TENS, Eloísa y estadísticas comparten contornos discretos. El estado inicial de
  Eloísa conserva su espacio reservado. Escalas y Especialidades se ubican en sus superficies de edición.
- `CensusTableViewport` observa el ancho real de tabla y contenedor. Si cabe, permite al encabezado
  permanecer bajo navegación y fechas (96 px); si no, conserva desplazamiento horizontal con
  teclado. No oculta columnas ni modifica preferencias de ancho. Impresión mantiene proporciones.
- Altas, Traslados y Hospitalización Diurna comparten identidad, encabezados, fechas y superficies;
  se conservan los accesos a epicrisis y los menús de acciones en portal.
- Los menús muestran cama y paciente, con deshacer/eliminar separados al final.
  Opciones y Epicrisis comparten altura y foco; con puntero táctil ofrecen un mínimo de
  44 px. Los valores ausentes se presentan como «Sin informar» sin modificar el registro.
  La descarga del egreso muestra su estado pendiente usando la solicitud existente.
- Validación visual reproducible: `npm run test:e2e:preview:census-bootstrap` usa datos sintéticos
  y cubre geometría de portátil, foco, admisión discreta, encabezado y menús sin recortes.

## Test entrypoints recomendados

- `npx vitest run src/tests/views/census`
- `npx vitest run src/tests/views/census/PatientClinicalAccess.test.tsx src/tests/views/census/patientClinicalTopicsController.test.ts`
- `npm run test:ci:unit`

## Comandos de validación del módulo

- `npm run typecheck`
- `npm run check:quality`
- `npm run test:ci:unit -- src/tests/views/census`

## Safe change links

- [docs/QUALITY_GUARDRAILS.md](../../../docs/QUALITY_GUARDRAILS.md)
- [docs/SAFE_CHANGE_CHECKLIST.md](../../../docs/SAFE_CHANGE_CHECKLIST.md)

Los enlaces de incidencias pueden abrir `/census?date=YYYY-MM-DD&focusBed=<cama>`.
Una vez cargada la tabla del día solicitado, se enfoca y centra la fila (ocupada o vacía)
con un contorno, sin activar sus acciones ni colorear toda la fila. El parámetro `focusBed`
se consume para no repetir el desplazamiento. Si una cama conocida no tiene fila visible,
se informa sin enfocar otra cama ni modificar el censo.

### Recuperación de antecedentes

`ClinicalPanelAntecedents` usa `ok` como resultado de la consulta, incluso cuando
la extensión no acompaña el fallo con un mensaje. Un fallo inicial ofrece reintento;
un fallo de actualización conserva los datos ya cargados. Los resultados parciales
y los fallos de actualización comparten una sola acción `Reintentar antecedentes`.
Cada episodio mantiene su propio estado y aborta el interés en respuestas anteriores
al cambiar de paciente; el reintento no modifica datos clínicos ni el protocolo de la extensión.

### Fuentes para copiar un día vacío

El recorrido activo es `useCensusViewModel` → `src/hooks/useCensusLogic.ts` →
`src/hooks/useCensusPromptState.ts` → `src/hooks/controllers/censusPromptController.ts`.
Este flujo histórico conserva su owner actual; no requiere otra API pública ni una
segunda implementación dentro de la feature. Las copias antiguas `hooks/useCensusPromptState`
y `controllers/censusLogicController` de esta feature no tenían consumidores productivos
y se retiraron. Sus pruebas ahora ejercitan el owner activo: el hook con los lectores
como puertos simulados, y el controller puro en su suite propia.

### Disponibilidad al mover o copiar

El modal usa `src/hooks/useMoveCopyTargetRecord.ts` como único owner. Para el día
actual proyecta directamente el registro vigente: no conserva una copia local de
las camas ni consulta almacenamiento. Para otra fecha mantiene la lectura asíncrona
y descarta respuestas obsoletas. Los cambios del objeto del día actual no vuelven
a consultar un destino externo. Si la cama seleccionada pasa a estar ocupada o deja
de ser visible, Confirmar se deshabilita; las protecciones de persistencia se conservan.

### Formularios de alta y traslado

Las pantallas `DischargeModal` y `TransferModal` usan los hooks de `src/hooks`, que
comparten `src/hooks/useModalFormFlow.ts`. Las reglas de validación y payload siguen
en los controllers existentes, a través de sus superficies actuales. Las pruebas de
formulario importan esos mismos hooks productivos; no se mantiene una segunda copia
en esta feature. Se conserva la inicialización al abrir, limpieza de errores por
campo, callbacks actualizados y validación de fecha/turno antes de confirmar.

### Ejecución de movimientos

`src/hooks/usePatientDischarges.ts`, `usePatientTransfers.ts` y `useCMA.ts` usan
los auxiliares de movimientos de `src/hooks`: registro vigente, feedback, auditoría
y ejecutores de creación, modificación y deshacer. Las pruebas importan esos mismos
owners. No se mantienen copias ni reexports locales en esta feature para los tests;
los controllers y contratos de aplicación conservan sus responsabilidades actuales.

### Estado de los modales de camas

`BedManagerModal` y `MoveCopyModal` mantienen su estado en
`src/hooks/useBedManagerModalModel.ts` y `src/hooks/useMoveCopyModalState.ts`.
Los tests del modelo apuntan a esas mismas implementaciones, junto con las pruebas
del modal. Los controllers de transición y las reglas de bloqueo, selección y
confirmación permanecen en sus capas actuales.

### Controles compactos del censo

- Enfermería, TENS, Eloísa y el resumen conservan una sola fila por defecto desde 1024 px, con el mismo orden de teclado y la altura de las tarjetas. El reflujo en dos filas se limita a anchos menores; Moa opcional puede pasar debajo del resumen sin desplazar los cuatro cuadros principales. Los controles de catálogo y configuración tienen una zona de clic mayor sin desplazar los selectores.
- El PDF de egreso se presenta como botón de descarga y mantiene sus dimensiones mientras espera; las etiquetas de procedencia sin acción siguen siendo informativas.
- Cada sección de movimientos indica cuántos registros muestra, incluyendo filas de RN; ese contador no modifica las estadísticas de egreso. Los estados vacíos son compactos y se refieren al día seleccionado.

- El reloj del encabezado de Scores filtra escalas por reaplicar y permite volver al censo completo.
- El selector de especialidad del paciente incorpora el icono de opciones del censo: conserva los permisos, reglas automáticas y asignación asistida existentes.
- La esquina del resumen alterna camas/movimientos y cumplimiento CUDYR del mes seleccionado. La vista mensual se carga sólo al abrirla, reutiliza el reporte guardado de HHR y su caché por sesión, sin consultar Eloísa. Excluye hoy y días futuros en Rapa Nui; las ventanas de aplicación abiertas tampoco contribuyen al consolidado. Una lectura pendiente o fallida nunca se presenta como oficial.

El lector mensual es un chunk opcional bajo demanda, igual que el lector histórico CUDYR del que depende. No aumenta el precache de instalación; una primera apertura sin red puede no disponer del módulo. El censo y los controles de escalas mantienen su precache.

### Indicaciones del explorador clínico

La fecha inicial es el día calendario actual de Rapa Nui, independiente de la fecha
del censo y del corte del turno. La fecha seleccionada filtra la hoja diaria ya leída
de Ficha Médico; no arrastra un tratamiento de otro día cuando no hay registros.
«Hoy» sigue el cambio de día; una fecha elegida explícitamente se conserva. Cambiar
de paciente o episodio restablece la fecha, y cambiar de sesión cierra el explorador.
Las indicaciones suspendidas siguen disponibles bajo su botón. Un fallo de lectura
se presenta como fallo, nunca como una fecha sin indicaciones.

La impresión libera sus controles si el navegador falla al abrir el diálogo o si
el documento local no carga en 30 segundos. El frame fallido se elimina y una carga
tardía no imprime; la persona puede reintentar. El diálogo ya abierto conserva su
ciclo habitual, sin cambiar el contenido ni la fecha de las indicaciones.

### Jerarquía del explorador clínico

La vista conjunta presenta evoluciones primero y la última toma de signos vitales
al lado derecho en escritorio amplio; en pantallas estrechas se apilan en ese orden.
Después aparecen laboratorio, imágenes e indicaciones. Las pestañas siguen ese orden.
El historial de evoluciones abre 20 entradas y permite mostrar más por bloques o
mostrar todas explícitamente. El filtro de profesión y un episodio nuevo comienzan
con 20 entradas; la vista conjunta conserva su resumen de tres. Se indica cuántas
entradas se muestran, y un filtro vacío se distingue de una ficha sin evoluciones.
Los signos vitales usan los datos del paciente/episodio ya disponibles en el censo,
con fecha de toma, unidades y los mismos perfiles visuales del censo. Pulsar el título
o una medición abre el mismo visor histórico del censo, con lectura bajo demanda
del episodio en días clinicalDerived y el mismo tratamiento de fallos. Los balances
de ingresos y diuresis del día aparecen en el panel, seguidos de las alertas activas
del paciente. Aislamiento se indica debajo de la cama en encabezado y lista; la
creación de documentos se abre desde «Informes locales». No modifica datos. Un valor ausente no se transforma en cero.
El acceso de regreso es un botón independiente, disponible incluso si el explorador
no termina de cargar; conserva Escape, el foco y el censo montado detrás.

En escritorio, el regreso ocupa el espacio sobre la lista de pacientes y se alinea
con la identidad, sin una franja superior adicional. Sigue fuera del módulo de
carga diferida. La lista tiene altura según su contenido, máximo visible y scroll.
Las acciones del paciente y las pestañas usan menos bordes; los iconos de sección
son neutros y los colores de vitales conservan su significado clínico. Los controles
de acción comparten altura, tipografía y foco; las selecciones usan verde azulado.
Las fechas y metadatos secundarios mantienen contraste legible sin competir con
los resultados clínicos.

El eje temporal del laboratorio ajusta sus etiquetas al ancho disponible, conserva
los extremos y señala el día del censo. Al cruzar de año incluye el año en la fecha.
Las etiquetas de calendario son limitadas por espacio; los resultados, sus valores,
los puntos seleccionables y la tabla diaria se conservan íntegros.

El laboratorio del explorador muestra hasta diez informes recientes, sin segundos ni
rangos de referencia en la tabla. Las filas compactas conservan unidades y valores
ausentes; cada columna mantiene la identidad del informe original y su acceso PDF,
incluso cuando dos informes comparten fecha y minuto.

### Descarga del explorador clínico

El botón de descarga del encabezado del paciente reúne, a pedido, la ficha clínica de Eloísa
(«Historial hospitalización» de las estadías que se cruzan con la actual, vía la extensión
0.48.71 o posterior), los resultados de Syslab del periodo elegido (por defecto, del ingreso
a hoy en Rapa Nui) y los informes de TAC de MMRAD de la hospitalización. Sale como un PDF
unido (ficha, exámenes y TAC, cada uno del más antiguo al más reciente) o como archivos
separados en un ZIP. No guarda nada en HHR ni en el navegador. Una parte que falla, o que
puede venir incompleta, se nombra con su motivo y la persona decide si descarga el resto; una
fuente sin documentos se informa como tal, distinta de un fallo. Un TAC que MMRAD registró con
otro dígito verificador no se incluye: se nombra para revisarlo en Imágenes. Una lectura de
Syslab que se está renovando se espera antes de escribir los resultados. Cambiar de sesión o de
paciente detiene la descarga, también la de la extensión, y no guarda nada. Las herramientas de
PDF y ZIP se cargan sólo al pulsar «Descargar», fuera del precache; el texto que escribe HHR
transcribe a caracteres imprimibles los símbolos que la fuente del PDF no tiene.
